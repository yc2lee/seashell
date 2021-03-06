import * as $ from "jquery";
import {SeashellWebsocket} from "./Websocket/WebsocketClient";
import {WebStorage} from "./Storage/WebStorage";
import {LocalStorage} from "./Storage/LocalStorage";
import {AbstractStorage,
        File, FileID, FileBrief,
        Project, ProjectID, ProjectBrief,
        Settings,
        OfflineMode} from "./Storage/Interface";
import {OnlineCompiler} from "./Compiler/OnlineCompiler";
import {OfflineCompiler} from "./Compiler/OfflineCompiler";
import {Connection} from "./Websocket/Interface";
import {AbstractCompiler,
        Test,
        CompilerResult,
        CompilerDiagnostic} from "./Compiler/Interface";
import {LoginError, LoginRequired} from "./Errors";
import {appStateActions} from "../reducers/appStateReducer";
export * from "./Storage/Interface";
export * from "./Compiler/Interface";
export {Services, DispatchFunction};

type DispatchFunction = (act: Object) => Object;

namespace Services {
  let connection: Connection;
  let dispatch: DispatchFunction | null = null;
  let socketClient: SeashellWebsocket | null = null;
  let localStorage: LocalStorage | null = null;
  let webStorage: WebStorage | null = null;
  let offlineCompiler: OfflineCompiler | null = null;
  let onlineCompiler: OnlineCompiler | null = null;
  let offlineMode: boolean = false;
  let debug: boolean;

  export function session() {
    return connection;
  }

  export function init(disp: DispatchFunction,
                       options?: { debugService?: boolean;
                                   debugWebSocket?: boolean;
                                   debugWebStorage?: boolean;
                                   debugLocalStorage?: boolean; }) {
    dispatch = disp;
    options  = options || {};
    debug    = options.debugService || false;

    socketClient    = new SeashellWebsocket(options.debugWebSocket);
    localStorage    = new LocalStorage(options.debugLocalStorage);
    webStorage      = new WebStorage(socketClient, localStorage, getOfflineMode(),
      options.debugWebStorage);
    offlineCompiler = new OfflineCompiler(localStorage, dispatch);
    onlineCompiler  = new OnlineCompiler(socketClient, webStorage, offlineCompiler,
      dispatch, webStorage.syncAll.bind(webStorage, false), getOfflineMode);

    if (disp !== null) {
      socketClient.register_callback("connected", () => disp({
        type: appStateActions.connected,
        payload: null
      }));
      socketClient.register_callback("disconnected", () => disp({
        type: appStateActions.disconnected,
        payload: null
      }));
    }
  }

  export function storage(): WebStorage {
    if (webStorage === null) {
      throw new Error("Must call Services.init() before Services.storage().");
    }
    return webStorage;
  }

  export function compiler(): AbstractCompiler {
    if (onlineCompiler === null) {
      throw new Error("Must call Services.init() before Services.compiler().");
    }
    return onlineCompiler;
  }

  export async function login(user: string,
                              password: string,
                              rebootBackend: boolean = false,
                              uri: string = "https://www.student.cs.uwaterloo.ca/~cs136/seashell-unstable/cgi-bin/login2.cgi"): Promise<void> {
    if (!localStorage || !socketClient || !webStorage) {
      throw new Error("Must call Services.init() before Services.login()");
    }
    let response;
    try {
      debug && console.log(`Logging in at ${uri} ...`);
      response = await <PromiseLike<any>>$.ajax({
        url: uri,
        type: "POST",
        data: {
          "u": user,
          "p": password,
          "reset": rebootBackend
        },
        dataType: "json",
        timeout: 10000
      });
      debug && console.log("Login succeeded.");
      response.user = user; // Save user so that we can log in later.
      window.localStorage.setItem("seashell-credentials", JSON.stringify(response));
    } catch (ajax) {
      if (ajax.status === 0) {
        if (ajax.statusText === "timeout") {
          throw new LoginError("Something bad happened - Login timed out :(");
        }
        throw new LoginError("Something bad happened - The Internet might be down :(");
      }
      const status     = ajax.status;
      const code       = ajax.responseJSON.error.code;
      const msg        = ajax.responseJSON.error.message;
      const statusText = ajax.statusText;
      if (code === 5) {
        throw new LoginError("Username and password don't match.");
      }
      throw new LoginError(`Login failure (${code}): ${msg}`, user, status, statusText);
    }

    // login successful
    await connectWith(new Connection(user,
                                     response.key,
                                     response.host,
                                     response.port,
                                     response.pingPort),
                      ! rebootBackend);
  }

  export async function logout(deleteDB: boolean = false): Promise<void> {
    if (!localStorage || !socketClient) {
      throw new Error("Must call Services.init() before Services.logout()");
    }
    await socketClient.disconnect();
    if (deleteDB) {
      await localStorage.deleteDB();
      debug && console.log("Deleted user's indexedDB.");
    }
    window.localStorage.removeItem("seashell-credentials");
    debug && console.log("User logged out.");
  }

  export async function autoConnect(): Promise<void> {
    if (!localStorage || !socketClient || !webStorage) {
      throw new Error("Must call Services.init() before Services.login()");
    }
    const credstring = window.localStorage.getItem("seashell-credentials");
    if (credstring) {
      const credentials = JSON.parse(credstring);
      // login successful --- we sync after we connect so the UI is still responsive
      return await connectWith(new Connection(credentials.user,
                                              credentials.key,
                                              credentials.host,
                                              credentials.port,
                                              credentials.pingPort),
                               false);
    } else {
      throw new LoginRequired();
    }
  }

  async function connectWith(cnn: Connection, sync: boolean = true): Promise<void> {
    if (!localStorage || !socketClient || !webStorage) {
      throw new Error("Must call Services.init() before Services.login()");
    }

    await localStorage.connect(`seashell8-${cnn.username}`);
    await socketClient.connect(cnn);
    connection = cnn;
    if (sync) {
      await webStorage.syncAll();
    }
  }

  export function getOfflineMode(): OfflineMode {
    const offlineSetting = window.localStorage.getItem("offline-mode-enabled");
    return offlineSetting ? JSON.parse(offlineSetting) : OfflineMode.Off;
  }

  export function setOfflineMode(mode: OfflineMode): void {
    window.localStorage.setItem("offline-mode-enabled", JSON.stringify(mode));
  }
}
