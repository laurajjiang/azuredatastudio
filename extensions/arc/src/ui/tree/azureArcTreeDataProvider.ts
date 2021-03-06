/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azdata from 'azdata';
import * as vscode from 'vscode';
import { ControllerTreeNode } from './controllerTreeNode';
import { TreeNode } from './treeNode';
import { LoadingControllerNode as LoadingTreeNode } from './loadingTreeNode';
import { ControllerModel, ControllerInfo } from '../../models/controllerModel';

const mementoToken = 'arcControllers';

/**
 * The TreeDataProvider for the Azure Arc view, which displays a list of registered
 * controllers and the resources under them.
 */
export class AzureArcTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {

	private _credentialsProvider = azdata.credentials.getProvider('arcControllerPasswords');
	private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined> = new vscode.EventEmitter<TreeNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined> = this._onDidChangeTreeData.event;

	private _loading: boolean = true;
	private _loadingNode = new LoadingTreeNode();

	private _controllerNodes: ControllerTreeNode[] = [];

	constructor(private _context: vscode.ExtensionContext) {
		this.loadSavedControllers().catch(err => console.log(`Error loading saved Arc controllers ${err}`));
	}

	public async getChildren(element?: TreeNode): Promise<TreeNode[]> {
		if (this._loading) {
			return [this._loadingNode];
		}

		if (element) {
			return element.getChildren();
		} else {
			return this._controllerNodes;
		}
	}

	public getTreeItem(element: TreeNode): TreeNode | Thenable<TreeNode> {
		return element;
	}

	public async addOrUpdateController(model: ControllerModel, password: string, refreshTree = true): Promise<void> {
		const controllerNode = this._controllerNodes.find(node => model.equals(node.model));
		if (controllerNode) {
			controllerNode.model.info = model.info;
		} else {
			this._controllerNodes.push(new ControllerTreeNode(model, this._context));
		}
		await this.updatePassword(model, password);
		if (refreshTree) {
			this._onDidChangeTreeData.fire(undefined);
		}
		await this.saveControllers();
	}

	public async removeController(controllerNode: ControllerTreeNode): Promise<void> {
		this._controllerNodes = this._controllerNodes.filter(node => node !== controllerNode);
		this._onDidChangeTreeData.fire(undefined);
		await this.saveControllers();
	}

	public async getPassword(info: ControllerInfo): Promise<string> {
		const provider = await this._credentialsProvider;
		const credential = await provider.readCredential(getCredentialId(info));
		return credential.password;
	}

	/**
	 * Refreshes the specified node, or the entire tree if node is undefined
	 * @param node The node to refresh, or undefined for the whole tree
	 */
	public refreshNode(node: TreeNode | undefined): void {
		this._onDidChangeTreeData.fire(node);
	}

	private async updatePassword(model: ControllerModel, password: string): Promise<void> {
		const provider = await this._credentialsProvider;
		if (model.info.rememberPassword) {
			provider.saveCredential(getCredentialId(model.info), password);
		} else {
			provider.deleteCredential(getCredentialId(model.info));
		}
	}

	private async loadSavedControllers(): Promise<void> {
		try {
			const controllerMementos: ControllerInfo[] = this._context.globalState.get(mementoToken) || [];
			this._controllerNodes = controllerMementos.map(memento => {
				const controllerModel = new ControllerModel(this, memento);
				return new ControllerTreeNode(controllerModel, this._context);
			});
		} finally {
			this._loading = false;
			this._onDidChangeTreeData.fire(undefined);
		}
	}

	private async saveControllers(): Promise<void> {
		await this._context.globalState.update(mementoToken, this._controllerNodes.map(node => node.model.info));
	}
}

function getCredentialId(info: ControllerInfo): string {
	return `${info.url}::${info.username}`;
}
