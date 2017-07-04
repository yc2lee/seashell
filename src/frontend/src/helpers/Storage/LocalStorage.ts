import Dexie from "dexie";
import "dexie-observable";
import "dexie-syncable";
import md5 = require("md5");
import {sprintf} from "sprintf-js";
import * as R from "ramda";
import {AbstractStorage,
        Contents, ContentsID, ContentsStored,
        File, FileID, FileBrief, FileStored,
        Project, ProjectID, ProjectBrief, ProjectStored,
        Settings, SettingsStored} from "./Interface";
import * as E from "../Errors";

export {LocalStorage}


interface DBOptions {
  addons?: Array<(db: Dexie) => void>;
  autoOpen?: boolean;
  indexedDB?: IDBFactory;
  IDBKeyRange?: new () => IDBKeyRange;
}

class LocalStorage implements AbstractStorage {
  // [index: string]: any; // supress type errors

  private db: StorageDB;
  private dbName: string;

  public constructor(public debug = false) { }

  public async connect(dbName: string): Promise<void> {
    this.dbName = dbName;
    this.db = new StorageDB(dbName, {
      IDBKeyRange: (<any>window).IDBKeyRange,
      indexedDB: (<any>window).indexedDB
    });

    await this.db.open();
  }

  public async deleteDB(): Promise<void> {
    return this.db.delete();
  }

  public async writeFile(fid: FileID, contents: string): Promise<FileID> {
    this.debug && console.log(`writeFile`);
    return this.db.transaction("rw", [this.db.contents, this.db.files], async () => {
      let file: File = await this.readFile(fid, false);
      if (!file) {
        throw new E.StorageError(`File ID ${fid} does not exist.`);
      }
      let nFile = await this.newFile(file.project_id, file.name, contents);
      let cid = await this.db.contents.add({
        project_id: file.project_id,
        file_id: fid,
        contents: contents,
        time: Date.now()
      });
      await this.deleteFile(file.project_id, fid);
      return nFile.id;
    });
  }

  public async readFile(fid: FileID, contents: boolean = true): Promise<File> {
    this.debug && console.log(`readFile`);
    let tbls: Dexie.Table<any, string>[] = [this.db.files];
    if (contents) tbls.push(this.db.contents);
    return await this.db.transaction("r", tbls, async () => {
      const file = await this.db.files.get(fid);
      if (!file) {
        throw new E.StorageError(`File "${fid}" does not exist.`);
      }
      let result = new File(fid, file);
      if (contents && result.contents_id) {
        const conts = await this.db.contents.get(result.contents_id);
        if (!conts) {
          throw new E.StorageError(`file ${file.name} has invalid contents.`);
        }
        result.contents = new Contents(result.contents_id, conts);
      }
      return result;
    });
  }

  public async deleteFile(project: ProjectID, filename: string): Promise<void> {
    this.debug && console.log(`deleteFile`);
    return await this.db.transaction("rw", this.db.files, async () => {
      const file = await this.getFileByName(project, filename);
      if (!file) {
        throw new E.StorageError(`Deleting file ${filename} which does not exist.`);
      } else {
        return this.db.files.delete(file.id);
      }
    });
  }

  public async renameFile(project: ProjectID, currentName: string, newName: string): Promise<FileBrief> {
    this.debug && console.log(`renameFile`);
    return await this.db.transaction("rw", [this.db.contents, this.db.files], async () => {
      let file = await this.getFileByName(project, currentName);
      if (!file) {
        throw new E.StorageError(`Renaming file ${currentName} which does not exist.`);
      }
      await this.deleteFile(project, file.name);
      let nFile = await this.newFile(project, newName, file.contents ? file.contents.contents : "");
      return new FileBrief(nFile.id, nFile);
    });
  }

  private async getProjectSetting(pid: ProjectID, key: string): Promise<string|undefined> {
    return this.db.transaction("r", this.db.projects, async () => {
      const project = await this.getProject(pid);
      return project.settings ? project.settings[key] : undefined;
    });
  }

  private async setProjectSetting(pid: ProjectID, key: string, value: string): Promise<void> {
    return this.db.transaction("rw", this.db.projects, async () => {
      const project = await this.getProject(pid);
      project.settings = project.settings || {};
      project.settings[key] = value;
      await this.db.projects.update(pid, {
        settings: project.settings,
        last_used: Date.now()
      });
    });
  }

  private runnerFileKey(question: string): string {
    return `${question}_runner_file`;
  }

  public async getFileToRun(pid: ProjectID, question: string): Promise<string|false> {
    this.debug && console.log(`getFileToRun`);
    return (await this.getProjectSetting(pid, this.runnerFileKey(question))) || false;
  }

  // a file name is (q*/tests|q*|common)/name
  public async setFileToRun(pid: ProjectID, question: string, filename: string): Promise<void> {
    this.debug && console.log(`setFileToRun`);
    return this.setProjectSetting(pid, this.runnerFileKey(question), filename);
  }

  public async getSettings(): Promise<Settings> {
    return await this.db.transaction("r", this.db.settings, async () => {
      this.debug && console.log(`getSettings`);
      const settings = await this.db.settings.get(0);
      return settings ? Settings.fromJSON(settings) : new Settings();
    });
  }

  public async setSettings(settings: Settings): Promise<void> {
    return await this.db.transaction("rw", this.db.settings, async () => {
      this.debug && console.log(`setSettings`);
      await this.db.settings.put({
        id: 0,
        editor_mode: settings.editor_mode,
        font_size: settings.font_size,
        font: settings.font,
        theme: settings.theme,
        space_tab: settings.space_tab,
        tab_width: settings.tab_width
      });
    });
  }

  public async getProjectFiles(pid: ProjectID): Promise<FileBrief[]> {
    this.debug && console.log(`getProjectFiles`);
    // this is called when we open a project, so we will update the last modified time here as well
    return await this.db.transaction("rw", [this.db.projects, this.db.files], async () => {
      const p: Project = await this.getProject(pid);
      p.last_used = Date.now();
      await this.db.projects.put(p);
      const fbs: FileBrief[] = [];
      await this.db.files.where("project_id").equals(pid).each((file: File) => {
        fbs.push(new FileBrief(file.id, file));
      });
      return fbs;
    });
  }

  public async newFile(pid: ProjectID,
                       name: string,
                       contents = ""): Promise<File> {
    this.debug && console.log(`newFile`);
    const rmatch: RegExpMatchArray | null = contents.match(/^data:([^;]*)?(?:;(?!base64)([^;]*))?(?:;(base64))?,(.*)/);
    if (rmatch !== null) {
      const mime = rmatch[1];
      const b64 = rmatch[3];
      if (b64 || mime === "base64") {
        contents = window.atob(rmatch[4]);
      }
    }
    return await this.db.transaction("rw", [this.db.contents, this.db.files], async () => {
      /*const exist = await this.db.files.where({
        name: name,
        project_id: pid
      });
      if (await exist.count() > 0) {
        throw new E.StorageError(`file "${pid}" "${name}" already exists`);
      }*/
      const fid = await this.db.files.add({
        project_id: pid,
        name: name,
        contents_id: false,
        flags: 0
      });
      const cid = await this.db.contents.add({
        project_id: pid,
        file_id: fid,
        contents: contents,
        time: Date.now()
      });
      await this.db.files.update(fid, {
        contents_id: cid
      });
      return this.readFile(fid, false);
    });
  }

  public async newQuestion(pid: ProjectID, question: string): Promise<void> {
    this.debug && console.log("newQuestion");
    return this.db.transaction("rw", this.db.files, () => {
      return this.db.files.add({
        project_id: pid,
        name: question,
        contents_id: false,
        flags: 0
      });
    });
  }

  public async deleteQuestion(pid: ProjectID, question: string): Promise<void> {
    this.debug && console.log("deleteQuestion");
    // delete the directory file entry and all children files
    return this.db.transaction("rw", this.db.files, () => {
      return this.db.files.where("name").startsWith(question).delete();
    });
  }

  public async newProject(name: string): Promise<ProjectBrief> {
    this.debug && console.log(`newProject`);
    return await this.db.transaction("rw", this.db.projects, async () => {
      const ps: ProjectStored = {
        name: name,
        settings: {},
        last_used: Date.now()
      };
      const pid = await this.db.projects.add(ps);
      return new ProjectBrief(pid, ps);
    });
  }

  public async deleteProject(pid: ProjectID): Promise<void> {
    this.debug && console.log(`deleteProject`);
    return await this.db.transaction("rw", [this.db.files, this.db.projects], async () => {
      await this.db.projects.delete(pid);
      const files = await this.db.files.where("project_id").equals(pid);
      await files.delete();
    });
  }

  public async getProject(pid: ProjectID): Promise<Project> {
    this.debug && console.log(`getProject`);
    return await this.db.transaction("r", this.db.projects, async () => {
      const p = await this.db.projects.get(pid);
      if (!p) {
        throw new E.StorageError(`project "${pid}" doesn't exist`);
      }
      return new Project(pid, p);
    });
  }

  public async getProjects(): Promise<ProjectBrief[]> {
    this.debug && console.log(`getProjects`);
    return await this.db.transaction("r", this.db.projects, async () => {
      const projs: ProjectBrief[] = [];
      await this.db.projects.toCollection().each((proj: Project) => {
        projs.push(new ProjectBrief(proj.id, proj));
      });
      return projs;
    });
  }

  public async getAllFiles(): Promise<FileBrief[]> {
    this.debug && console.log(`getAllFiles`);
    return await this.db.transaction("r", this.db.files, async () => {
      const result = await this.db.files.toArray();
      return R.map((file: File) => new FileBrief(file.id, file), result);
    });
  }

  private openFilesKey(question: string): string {
    return `${question}_open_files`;
  }

  public async getFileByName(pid: ProjectID, filename: string, getContents: boolean = true): Promise<File|false> {
    const tbls = getContents ?
                 [this.db.files, this.db.contents] :
                 [this.db.files];
    return this.db.transaction("r", tbls, async () => {
      let result = await this.db.files.where("name").equals(filename).toArray();
      if (result.length > 1) {
        throw new E.ConflictError(filename, result.map((file) => new File(<FileID>file.id, file)));
      } else if (result.length === 0) {
        return false;
      } else {
        let file = new File(<FileID>result[0].id, result[0]);
        if (getContents && file.contents_id) {
          let contents = await this.db.contents.get(file.contents_id);
          if (contents === undefined) {
            throw new E.StorageError(`File contents for ${filename} does not exist.`);
          } else {
            file.contents = new Contents(file.contents_id, contents);
          }
        }
        return file;
      }
    });
  }

  public async getOpenFiles(pid: ProjectID, question: string): Promise<string[]> {
    this.debug && console.log(`getOpenFiles`);
    return this.db.transaction("r", this.db.projects, async () => {
      return JSON.parse(await this.getProjectSetting(pid, this.openFilesKey(question)) || "[]");
    });
  }

  public async addOpenFile(pid: ProjectID, question: string, filename: string): Promise<void> {
    this.debug && console.log(`addOpenFile`);
    return this.db.transaction("rw", this.db.projects, async () => {
      const open = JSON.parse(await this.getProjectSetting(pid, this.openFilesKey(question)) || "[]");
      return this.setProjectSetting(
        pid,
        this.openFilesKey(question),
        JSON.stringify(open.concat([filename])));
    });
  }

  public async removeOpenFile(pid: ProjectID, question: string, fid: FileID): Promise<void> {
    this.debug && console.log(`removeOpenFile`);
    return this.db.transaction("rw", this.db.projects, this.db.files, async () => {
      const openNames = JSON.parse(await this.getProjectSetting(pid, this.openFilesKey(question)) || "[]");
      const removedFile = await this.readFile(fid, false);
      return this.setProjectSetting(
        pid,
        this.openFilesKey(question),
        JSON.stringify(openNames.filter((f: string) =>
          f !== removedFile.name
        )));
    });
  }
}

class StorageDB extends Dexie {
  public contents: Dexie.Table<ContentsStored, ContentsID>;
  public files: Dexie.Table<FileStored, FileID>;
  public projects: Dexie.Table<ProjectStored, ProjectID>;
  public settings: Dexie.Table<SettingsStored, number>;

  public constructor(dbName: string, options?: DBOptions) {
    super(dbName, options);
    this.version(1).stores({
      contents: "$$id, project_id, file_name",
      files: "$$id, [name+project_id], name, project_id",
      projects: "$$id, name",
      settings: "$$id"
    });

    // No TS bindings for Dexie.Syncable
    (<any>this).syncable.connect("seashell", "http://no-host.org");
    (<any>this).syncable.on("statusChanged", (newStatus: any, url: string) => {
      console.log(`Sync status changed: ${(<any>Dexie).Syncable.StatusTexts[newStatus]}`);
    });
  }
}
