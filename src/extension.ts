import * as vscode from 'vscode';
//import * as cp from 'child_process';
import WebSocket from 'ws';
import * as model from './workspaceNodeProvider';
import { Guid } from "guid-typescript";
import { NetDebugConfigProvider } from './netDebugConfigProvider';
import { detailsKeys } from './detailsKeys'

let globalSocket: WebSocket;

export async function activate(context: vscode.ExtensionContext) {

  const channel = vscode.window.createOutputChannel("ring!");
  const wsStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
  const runnablesViewName = "runnables";
  const wsModel = new model.WorkspaceProvider(context);
  vscode.window.registerTreeDataProvider('runnables', wsModel);
  vscode.window.createTreeView(runnablesViewName, { treeDataProvider: wsModel });
  wsStatus.command = 'ring.showRingView';
  wsStatus.text = `$(heart)`;
  wsStatus.color = "#000000";
  wsStatus.tooltip = "DISCONNECTED";
  wsStatus.show();

  const provider = new NetDebugConfigProvider(wsModel);
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('ring', provider));

  ///////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  // Commands
  //
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////
  context.subscriptions.push(vscode.commands.registerCommand('ring.loadStartWorkspace', async () => await loadWorkspace()));
  context.subscriptions.push(vscode.commands.registerCommand('ring.sync', async () => {
    await syncRing();
    await vscode.commands.executeCommand('ring.showRingView');

  }));
  context.subscriptions.push(vscode.commands.registerCommand('ring.stopWorkspace', async () => await sendMessage(M.STOP)));
  context.subscriptions.push(vscode.commands.registerCommand('ring.startWorkspace', async () => await sendMessage(M.START)));
  context.subscriptions.push(vscode.commands.registerCommand('ring.unloadWorkspace', async () => await sendMessage(M.UNLOAD)));

  context.subscriptions.push(vscode.commands.registerCommand('ring.applyWorkspaceFlavour', async () => {

    const flavours = wsModel.current().Flavours.filter(x => x !== wsModel.current().CurrentFlavour).sort();
    const id = await vscode.window.showQuickPick(flavours);
    if (!id || wsModel.current().CurrentFlavour === id) { return; }
    await sendMessage(M.WORKSPACE_APPLY_FLAVOUR, id)
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.startRunnable', async (ctx: model.RunnableNode) => {

    await contextOrFromPickList(r => sendMessage(M.RUNNABLE_INCLUDE, r.Id), ctx, r => r.State === 'ZERO');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.stopRunnable', async (ctx: model.RunnableNode) => {

    await contextOrFromPickList(r => sendMessage(M.RUNNABLE_EXCLUDE, r.Id), ctx, r => r.State !== 'ZERO');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.restartRunnable', async (ctx: model.RunnableNode) => {

    async function restart(r: model.IRunnableInfo) {
      sendMessage(M.RUNNABLE_EXCLUDE, r.Id);
      sendMessage(M.RUNNABLE_INCLUDE, r.Id);
    }

    await contextOrFromPickList(restart, ctx, r => r.State === 'DEAD');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.showRingView', async () => {
    await vscode.commands.executeCommand("workbench.view.extension.ring-view");
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.revealContainingWorkspace', async (ctx: model.RunnableNode) => {

    async function selectAndLoad(r: model.IRunnableInfo) {
      let workspacePath: string = "";
      if (r.DeclaredIn.length > 1) {
        const path = await vscode.window.showQuickPick(r.DeclaredIn);
        if (path) { workspacePath = path; }
      }
      else { workspacePath = r.DeclaredIn[0]; }

      if (workspacePath) {
        const doc = await vscode.workspace.openTextDocument(workspacePath);
        vscode.window.showTextDocument(doc);
      }
    }

    await contextOrFromPickList(selectAndLoad, ctx);
  }));


  context.subscriptions.push(vscode.commands.registerCommand('ring.revealInExplorer', async (ctx: model.RunnableNode) => {

    async function revealInExplorer(r: model.IRunnableInfo) {
      const workDir = r.Details[detailsKeys.workDirKey] as string;

      if (workDir) {
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(workDir));
      }
    }

    await contextOrFromPickList(revealInExplorer, ctx);

  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.revealInOctant', async (ctx: model.RunnableNode) => {

    async function browseTo(r: model.IRunnableInfo) {
      const namespacedPods = r.Details[detailsKeys.pods] as string;

      if (namespacedPods) {
        let namespacedPod = namespacedPods.split("|")[0];
        let chunks = namespacedPod.split("/")
        let ns = chunks[0]
        let pod = chunks[1]
        const config = vscode.workspace.getConfiguration('ring');

        let octantUrl = config.get<string>("octantUrl");
        await vscode.env.openExternal(vscode.Uri.parse(`${octantUrl}/#/overview/namespace/${ns}/workloads/pods/${pod}`));

      }
    }

    await contextOrFromPickList(browseTo, ctx);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.openFolder', async (ctx: model.RunnableNode) => {

    async function openFolder(r: model.IRunnableInfo) {
      const workDirKey: string = "workDir";

      const workDir = r.Details[workDirKey] as string;

      if (workDir) {
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(workDir));
      }
    }

    await contextOrFromPickList(openFolder, ctx);

  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.openTerminal', async (ctx: model.RunnableNode) => {

    async function openTerminal(r: model.IRunnableInfo) {
      const workDirKey: string = "workDir";

      const workDir = r.Details[workDirKey] as string;

      if (workDir) {
        let t = vscode.window.activeTerminal;
        if (t === undefined) {
          t = vscode.window.createTerminal();
          t.show();
        }

        if (t) {
          t.show();
          t.sendText(`cd ${workDir}`);
        }
      }
    }

    await contextOrFromPickList(openTerminal, ctx);

  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.browseRunnable', async (ctx: model.RunnableNode) => {

    async function browseTo(r: model.IRunnableInfo) {
      const uri = r.Details[detailsKeys.uriKey] as string;

      if (uri) { await vscode.env.openExternal(vscode.Uri.parse(uri)); }
    }

    await contextOrFromPickList(browseTo, ctx);

  }));


  context.subscriptions.push(vscode.commands.registerCommand('ring.runTask', async (ctx: model.RunnableNode) => {

    async function browseTo(r: model.IRunnableInfo) {
      
      const id = await vscode.window.showQuickPick(r.Tasks);
      if (!id) { return; }
      await sendMessage(M.RUNNABLE_EXECUTE_TASK, JSON.stringify({RunnableId: r.Id, TaskId: id}))
      
    }

    await contextOrFromPickList(browseTo, ctx);

  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.debugRunnable', async (ctx: model.RunnableNode) => {

    const folders = vscode.workspace.workspaceFolders;

    const runnableFolderNotOpened = "The runnable's folder is not open in VS Code";

    if (!folders) {
      vscode.window.showInformationMessage(runnableFolderNotOpened);
      return;
    }

    const folder = folders.find(f => f.name === ctx.runnable.Id);

    if (!folder) {
      vscode.window.showInformationMessage(runnableFolderNotOpened);
      return;
    }
    const cfg = getConfiguration(ctx.runnable);
    if (cfg) { vscode.debug.startDebugging(folder, cfg); }
    else { vscode.window.showInformationMessage(`Could not resolve debug configuration for runnable type '${ctx.runnable.Type}'`); }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ring.pickRunnablePid', async () => {
    return await pickRunnablePid();

  }));



  vscode.tasks.onDidStartTask(async e => {

    const task = e.execution.task;

    switch (task.name) {
      case "build":
        {
          let folder = <vscode.WorkspaceFolder>task.scope;
          if (folder) {
            await sendMessage(M.RUNNABLE_EXCLUDE, folder.name);
          }

          break;
        }
      default:
        break;
    }

  });

  vscode.tasks.onDidEndTask(async e => {

    const task = e.execution.task;

    switch (task.name) {
      case "build":
        {
          let folder = <vscode.WorkspaceFolder>task.scope;
          if (folder) {
            await sendMessage(M.RUNNABLE_INCLUDE, folder.name);
          }

          break;
        }
      default:
        break;
    }

  });


  vscode.debug.onDidStartDebugSession(async e => {

    // const folder = e.workspaceFolder;
    // if (folder)
    // {
    //  await sendMessage(M.RUNNABLE_EXCLUDE, folder.name);
    // }

  });

  vscode.debug.onDidTerminateDebugSession(async e => {

    // const folder = e.workspaceFolder;
    // if (folder)
    // {
    //  await sendMessage(M.RUNNABLE_INCLUDE, folder.name);
    // }
  });

  ///////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  // Functions
  //
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////
  async function contextOrFromPickList(action: (r: model.IRunnableInfo) => void, ctx?: model.RunnableNode, pickListFilter?: (r: model.IRunnableInfo) => boolean) {
    if (!ctx) {
      let sorted = wsModel.current().Runnables.sort();
      if (pickListFilter) { sorted = sorted.filter(pickListFilter); }
      const id = await vscode.window.showQuickPick(sorted.map(k => k.Id));
      if (!id) { return; }
      const r = wsModel.getRunnable(id);

      if (r) { action(r.runnable); }
    }
    else { action(ctx.runnable); }
  }

  async function pickRunnablePid() {
    const pidKey = "processId";
    const fs = vscode.workspace.workspaceFolders;
    let pid = 0;

    if (fs && fs.length === 1) {
      const r = wsModel.getRunnable(fs[0].name);

      if (r) {
        pid = r.runnable.Details[pidKey];
        return `${pid}`;
      }
    }

    await contextOrFromPickList(r => {

      pid = r.Details[pidKey] as number;
    });

    if (pid && pid > 0) { return `${pid}`; }
  }

  async function loadWorkspace() {
    const uris = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false });
    if (!uris) { return; }
    const file = uris.pop();
    if (!file) { return; }

    const workspacePath = file.fsPath;
    const state = wsModel.current().ServerState;

    if (state === 'RUNNING') { await sendMessage(M.STOP); }
    if (state === 'LOADED') { await sendMessage(M.UNLOAD); }
    await sendMessage(M.LOAD, workspacePath);
    await sendMessage(M.START);
  }

  async function sendMessage(message: M, payload?: string) {
    globalSocket.send(String.fromCharCode(message) + payload);
  }

  async function dispatch(message: M, payload: Buffer) {
    let m = M[message];

    channel.appendLine(m + " " + payload);

    function setStoppedStatus() {
      wsStatus.color = "#888888";
      wsStatus.tooltip = "STOPPED";
    }

    switch (message) {
      case M.SERVER_IDLE:
        wsStatus.color = "#ffffff";
        const loadButton = "Load workspace";
        const pressed = await vscode.window.showInformationMessage(`ring! connected`, loadButton);
        if (pressed === loadButton) {
          await loadWorkspace();
        }

        wsModel.current().ServerState = 'IDLE';
        break;
      case M.SERVER_LOADED:
        setStoppedStatus();
        await sendMessage(M.WORKSPACE_INFO_RQ);
        wsModel.current().ServerState = 'LOADED';
        vscode.window.showInformationMessage(`Workspace loaded: ${payload}`);
        break;
      case M.SERVER_RUNNING:
        await sendMessage(M.WORKSPACE_INFO_RQ);
        wsModel.current().ServerState = 'RUNNING';
        vscode.window.showInformationMessage(`Workspace running: ${payload}`);
        break;

      case M.WORKSPACE_INFO_PUBLISH:

        wsModel.updateWorkspace(<model.IWorkspaceInfo>JSON. parse(payload.toString()));

        const healthy = "#00dd00";
        const degraded = "#ff8800";
        const stopped = "#888888";

        wsStatus.color =
          wsModel.current().WorkspaceState === 'HEALTHY' ? healthy :
          wsModel.current().WorkspaceState === 'DEGRADED' ? degraded : stopped;

        wsStatus.tooltip = wsModel.current().WorkspaceState.toString();

        break;
      case M.RUNNABLE_UNRECOVERABLE:
        {
          const runnableId = payload.toString();
          wsModel.updateRunnable(runnableId, 'DEAD');
          vscode.window.showWarningMessage(`Runnable dead: ${runnableId}`, "Restart");
          break;
        }
      case M.RUNNABLE_STARTED:
        {
          const runnableId = payload.toString();
          wsModel.updateRunnable(runnableId, 'STARTED');
          break;
        }
      case M.RUNNABLE_RECOVERING:
        {
          const runnableId = payload.toString();
          wsModel.updateRunnable(runnableId, 'RECOVERING');
          break;
        }
      case M.RUNNABLE_HEALTH_CHECK:
        {
          const runnableId = payload.toString();
          wsModel.updateRunnable(runnableId, 'HEALTH_CHECK');
          break;
        }
      case M.RUNNABLE_HEALTHY:
        {
          const runnableId = payload.toString();
          wsModel.updateRunnable(runnableId, 'HEALTHY');
          break;
        }
      case M.RUNNABLE_INITIATED:
        {
          const runnableId = payload.toString();
          wsModel.updateRunnable(runnableId, 'INITIATED');
          break;
        }
      case M.RUNNABLE_DESTROYED:
      case M.RUNNABLE_STOPPED:
        {
          const runnableId = payload.toString();
          wsModel.updateRunnable(runnableId, 'ZERO');
          break;
        }
      case M.ACK:
        const b = payload[0]
        const ack = Ack[b]
        vscode.window.showInformationMessage(`ACK: ${ack}`);
      default:
        break;
    }
  }

  async function syncRing(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      if (globalSocket !== undefined && globalSocket.readyState === WebSocket.OPEN) {
        globalSocket.close(WebSocketCode.NORMAL_CLOSURE);
        globalSocket.terminate();
      }

      const config = vscode.workspace.getConfiguration('ring');

      let url = config.get<string>("serverUrl");

      if (!url) { return reject("ring! server url cannot be empty"); }
      url += `?clientId=${Guid.create()}`;

      globalSocket = new WebSocket(url);

      globalSocket.onmessage = async e => {
        let msg = <Buffer>e.data;
        await dispatch(msg[0], msg.slice(1));
      };

      globalSocket.onopen = e => {
        channel.appendLine(`Connected to ring! server at ${url}`);
        return resolve(globalSocket);
      };

      globalSocket.onclose = async e => {

        const message = `Connection closed. Code: ${e.code}. Reason: ${e.reason}`;
        channel.appendLine(message);
        if (e.code !== WebSocketCode.NORMAL_CLOSURE) { vscode.window.showErrorMessage(message); }
        wsStatus.color = "#000000";
        wsStatus.tooltip = "DISCONNECTED";
        wsModel.resetWorkspace();
        e.target.close();
        e.target.terminate();
      };
    });
  }
}


// this method is called when your extension is deactivated
export function deactivate() {
  if (globalSocket !== undefined) { globalSocket.terminate(); }
}


export function getConfiguration(runnable: model.IRunnableInfo): vscode.DebugConfiguration | undefined {
  switch (runnable.Type.toLowerCase()) {
    case 'netexe':
    case 'iisexpress': return {
      type: "clr",
      request: "attach",
      name: ".NET Framework Attach (IIS Express)",
      processId: "${command:ring.pickRunnablePid}"
    };
    case 'aspnetcore':
      return {
        name: ".NET Core Launch (console)",
        type: "coreclr",
        request: "attach",
        processId: "${command:ring.pickRunnablePid}"
      };

    default: return undefined;
  }
}

enum WebSocketCode {
  NORMAL_CLOSURE = 1000
}


enum M {
  DISCONNECTED = 0,
  LOAD = 62,
  UNLOAD = 60,
  START = 35,
  STOP = 36,
  TERMINATE = 81,
  RUNNABLE_INCLUDE = 43,
  INCLUDE_ALL = 44,
  RUNNABLE_EXCLUDE = 45,
  RUNNABLE_EXECUTE_TASK = 46,
  ACK = 58,
  PING = 2,
  WORKSPACE_INFO_RQ = 63,
  RUNNABLE_INITIATED = 11,
  RUNNABLE_STARTED = 12,
  RUNNABLE_STOPPED = 13,
  RUNNABLE_HEALTH_CHECK = 14,
  RUNNABLE_HEALTHY = 15,
  RUNNABLE_UNRECOVERABLE = 16,
  RUNNABLE_RECOVERING = 17,
  RUNNABLE_DESTROYED = 18,

  WORKSPACE_DEGRADED = 19,
  WORKSPACE_HEALTHY = 20,
  WORKSPACE_STOPPED = 21,
  WORKSPACE_INFO_PUBLISH = 26,
  WORKSPACE_APPLY_FLAVOUR = 27,
  SERVER_IDLE = 22,
  SERVER_LOADED = 23,
  SERVER_RUNNING = 24
}

enum Ack {
    None = 0,
    Ok = 1,
    ExpectedEndOfMessage = 2,
    NotSupported = 3,
    ServerError = 4,
    Terminating = 5,
    NotFound = 6,
    Alive = 7,
    TaskFailed = 8,
    TaskOk = 9
}
