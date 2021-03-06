import "jest";
import {LocalStorage, ChangeLog} from "../../src/helpers/Storage/LocalStorage";
import {File, FileID, FileBrief,
        Project, ProjectID, ProjectBrief,
        Settings} from "../../src/helpers/Services";
import J = require("jscheck");
import FakeIndexedDB = require("fake-indexeddb");
import FDBKeyRange = require("fake-indexeddb/lib/FDBKeyRange");
import Dexie from "dexie";
import {map, filter, flatten, repeat, head, prop} from "ramda";
import R = require("ramda");
import md5 = require("md5");
import * as LS from "localstorage-memory";

(<any>jasmine).DEFAULT_TIMEOUT_INTERVAL = 10 * 1000;
(<any>window).localStorage = LS;
(<any>window).indexedDB = FakeIndexedDB;
(<any>window).IDBKeyRange = FDBKeyRange;

const testSize = 5; // must be >= 5
const halfTestSize = Math.ceil(testSize / 2);

let unique = 0;
// should return a thunk, see jscheck documentation
function uniqStr(len: number): () => string {
  return () => J.string(J.number(0, len), J.character())() + (++unique);
}

function uniqStrArr(arrLen: number, strLen: number): () => string[] {
  return J.array(arrLen, uniqStr(strLen));
}

describe("Testing LocalStorage interface functions", () => {

  const store = new LocalStorage();

  store.connect("test");

  let projs: Project[] = R.sortBy(prop("id"), map((s: string) => new Project({
    id: md5(s),
    name: s,
    last_modified: 0,
    settings: {}
  }), uniqStrArr(testSize, 30)()));

  let files: File[] = R.sortBy(prop("id"), map((p: Project) => {
    const name = uniqStr(30)();
    const fid = md5(p.id + name);
    const text = uniqStr(5000)();
    const checksum = md5(text);
    return new File({
      id: fid,
      project: p.id,
      name: name,
      contents: text,
      checksum: checksum,
      last_modified: 0,
      open: 0
    });
  }, flatten(repeat(projs, testSize))));

  function genRunFiles(p: string): {[index: string]: FileID} {
    return R.zipObj<string>(uniqStrArr(testSize, 1)(),
                    J.array(testSize, J.one_of(map((file) => [p, file.name], files)))());
  }

  async function localFiles(): Promise<File[]> {
    let localFiles = await store.getAllFiles();
    for (let x of localFiles) {
      const file = await store.readFile(x.id);
      Object.assign(x, file);
    }
    localFiles = R.sortBy(prop("id"), localFiles) || [];
    return map((x) => new File({
      id: x.id,
      project: x.project,
      name: x.name,
      contents: x.contents,
      checksum: x.checksum,
      last_modified: 0,
      open: false
    }), localFiles);
  }

  async function localProjs() {
    let dbProjs: ProjectBrief[] = await store.getProjects();
    const local: Project[] = [];
    for (const p of dbProjs) {
      local.push(await store.getProject(p.id));
    }
    return R.sortBy(prop("id"), map((p) => new Project({
      // properties you want to check
      id: p.id,
      name: p.name,
      settings: p.settings,
      last_modified: 0
    }), local)) || [];
  }

  it(`newProject: create ${testSize} projects`, async () => {
    let ids: ProjectID[] = [];
    for (const p of projs) {
      ids.push((await store.newProject(p.name)).id);
    }
    expect(R.sortBy(prop("id"), ids)).toEqual(R.map(prop("id"), projs));
    expect(await localProjs()).toEqual(projs);
  });


  it(`getProjects: list all projects`, async () => {
    expect(await localProjs()).toEqual(projs);
  });

  it(`getFileToRun: should return undefined when no run files`, async () => {
    for (const p of projs) {
      const f = await store.getFileToRun(p.id, "__this_is_not_a_question");
      expect(f).toEqual(false);
    }
  });

  it(`newFile: create ${testSize} files per project`, async () => {
    for (const f of files) {
      const file = await store.newFile(f.project, f.name, f.contents);
      f.id = file.id;
    }
    expect(await localFiles()).toEqual(files);
    expect(await localProjs()).toEqual(projs);
  });

  it(`getFiles: list files per project`, async () => {
    expect(await localFiles()).toEqual(files);
  });

  it(`readFile: read all files`, async () => {
    for (const f of files) {
      const r = await store.readFile(f.id);
      const a = [f.name, f.project, f.contents];
      const b = [r.name, r.project, r.contents];
      expect(a).toEqual(b);
    };
  });

  it(`writeFile: update ${halfTestSize} files`, async () => {
    const fs = R.take(halfTestSize, files);
    for (const f of fs) {
      const text = uniqStr(5000)();
      f.contents = text;
      await store.writeFile(f.id, f.contents);
      expect(await localFiles()).toEqual(files);
    }
  });

  it(`setFileToRun: set each file as the run file for "default" in its project`, async () => {
    // group files by project id
    const projGps = R.groupBy((x: File) => x.project, files);
    for (const pid in projGps) {
      const proj = R.find((x) => x.id === pid, projs); // project object
      const pfiles = projGps[pid]; // files for current project
      for (const f of pfiles) {
        await store.setFileToRun(pid, "default", f.name);
        await store.setFileToRun(pid, `dummy`, f.name);
        await store.setFileToRun(pid, "dummy2", "dummy2");
        proj.settings["default_runner_file"] = f.name;
        proj.settings["dummy_runner_file"] = f.name;
        proj.settings["dummy2_runner_file"] = "dummy2";
        expect(await localProjs()).toEqual(projs);
      }
    }
  });

  // it(`updateProject: update run files`, async () => {
  //   for (const p of projs) {
  //     p.runs = genRunFiles(p.name);
  //     await store.updateProject(p);
  //   }
  //   expect(await localProjs()).toEqual(projs);
  // });

  it(`renameFile: rename ${halfTestSize} files per project.`, async () => {
    const projGps = R.groupBy((x: File) => x.project, files);
    for (const p in projGps) {
      const pj = R.find((x) => x.id === p, projs);
      console.assert(pj);
      for (const i of R.range(0, Math.min(halfTestSize, projGps[p].length))) {
        const file = projGps[p][i];
        const newname = file.name + "_new_name";
        const contents = file.contents;
        Object.assign(file, await store.renameFile(file.id, newname));
        file.contents = contents;
        file.last_modified = 0;
        files = R.sortBy(prop("id"), files);
        expect(await localFiles()).toEqual(files);
        expect(await localProjs()).toEqual(projs);
      }
    }
  });

  it(`deleteFile: delete ${halfTestSize} files per project. Should also remove from run files.`, async () => {
    const projGps = R.groupBy((x: File) => x.project, files);
    for (const p in projGps) {
      const pj = R.find((x) => x.id === p, projs);
      console.assert(pj);
      for (const i of R.range(0, Math.min(halfTestSize, projGps[p].length))) {
        const file = projGps[p][i];
        await store.setFileToRun(pj.id, "default", file.name);
        await store.deleteFile(file.id);
        files = filter((x) => x.id !== file.id, files);
        delete pj.settings["default_runner_file"];
        for (let k in pj.settings) {
          if (pj.settings[k] === file.name) {
            delete pj.settings[k];
          }
        }
      }
    }
    expect(await localProjs()).toEqual(projs);
    expect(await localFiles()).toEqual(files);
  });

  it(`deleteProject: delete ${halfTestSize} projects. Should also delete children.`, async () => {
    for (const i of R.range(0, halfTestSize)) {
      const proj = projs[i];
      await store.newFile(proj.id, "should_be_removed", "should_be_removed");
      await store.deleteProject(proj.id);
      projs = R.remove(i, 1, projs);
      files = R.filter((f) => f.project !== proj.id, files);
    }
    expect(await localProjs()).toEqual(projs);
    expect(await localFiles()).toEqual(files);
  });

  it("getSettings: should return default Settings when unset", async () => {
    const s = await store.getSettings();
    expect(s).toEqual(new Settings());
  });

  it("setSettings: set random properties", async () => {
    const s: Settings = new Settings();
    s.font_size = 100;
    await store.setSettings(s);
    const r = await store.getSettings();
    expect(r).toEqual(s);
  });

  it("getOpenTabs: should return empty initially", async () => {
    for (const pj of projs) {
      const ls: FileBrief[] = await store.getOpenFiles(pj.id, "default");
      expect(ls).toEqual([]);
    }
  });

  it(`addOpenTab: open ${halfTestSize} files per project`, async () => {
    for (const pj of projs) {
      const pjfs: FileBrief[]
        = R.map((f) => new FileBrief(f),
                R.sortBy(prop("id"),
                         R.take(halfTestSize,
                                R.filter((f: File) => f.project === pj.id,
                                         files))));
      for (const f of pjfs) {
        await store.addOpenFile(pj.id, "default", f.id);
      }
      const result: FileBrief[] = R.sortBy<FileBrief>(prop("id"),
        await store.getOpenFiles(pj.id, "default"));
      result.forEach((fb: FileBrief) => {
        fb.last_modified = 0;
      });
      expect(result).toEqual(pjfs);
    }
  });

  it(`removeOpenTab: close all files per project`, async () => {
    for (const pj of projs) {
      let openFiles: FileBrief[] = await store.getOpenFiles(pj.id, "default");
      for (const f of openFiles) {
        await store.removeOpenFile(pj.id, "default", f.id);
        const result: FileBrief[] = await store.getOpenFiles(pj.id, "default");
        const target: FileBrief = R.find((fb: FileBrief) => fb.id === f.id, openFiles);
        openFiles = R.without([target], openFiles);
        expect(result).toEqual(openFiles);
        const testFile = R.find((fb: FileBrief) => fb.id === f.id, files);
      }
      // Sync settings
      let storedProj = await store.getProject(pj.id);
      pj.settings = storedProj.settings;
    }
  });



  it("checking final state" , async () => {
    expect(await localProjs()).toEqual(projs);
    expect(await localFiles()).toEqual(files);
  });

});


describe("Testing offline mode synchronization", () => {

  const store = new LocalStorage();

  store.connect("test");

  it("clearChangeLogs: clear existing change logs", async () => {
    store.clearChangeLogs();
    expect(await store.getChangeLogs()).toEqual([]);
  });

  it("getChangeLogs: should return empty array when there is no change log", async () => {
    expect(await store.getChangeLogs()).toEqual([]);
  });

  it("topChangeLog: should return false when there is no change log", async () => {
    expect(await store.topChangeLog()).toEqual(false);
  });

  it("popChangeLog: should return false when there is no change log", async () => {
    expect(await store.popChangeLog()).toEqual(false);
  });

  it("countChangeLog: should return 0 when there is no change log", async () => {
    expect(await store.countChangeLogs()).toEqual(0);
  });

  it("pushChangeLog: push some changes", async () => {
    await store.pushChangeLog({type: "dummy1"});
    await store.pushChangeLog({type: "dummy2"});
    await store.pushChangeLog({type: "dummy3"});
  });

  it("countChangeLog: count pushed changes", async () => {
    expect(await store.countChangeLogs()).toEqual(3);
  });

  it("getChangeLogs: get all changes", async () => {
    let logs = await store.getChangeLogs();
    expect(logs).toEqual([
      {id: logs[0].id, type: "dummy3"},
      {id: logs[1].id, type: "dummy2"},
      {id: logs[2].id, type: "dummy1"}
    ]);
  });

  it("topChangeLog: get latest change", async () => {
    const log = <ChangeLog> await store.topChangeLog();
    expect(log).toEqual({
      id: log.id,
      type: "dummy3"
    });
  });

  it("popChangeLog: remove and return the latest change", async () => {
    let top;
    top = await store.popChangeLog();
    expect(top).toEqual({
      id: top.id,
      type: "dummy3"
    });
    top = await store.topChangeLog();
    expect(top).toEqual({
      id: top.id,
      type: "dummy2"
    });
  });

  const projName: string = uniqStr(30)();
  const fileName: string = uniqStr(30)();
  const fileContents: string = uniqStr(5000)();
  let fileID;
  let projID;

  it("newFile: should push a change", async () => {
    projID = (await store.newProject(projName)).id;
    const fb = await store.newFile(projID, fileName, fileContents);
    fileID = fb.id;
    const log = <ChangeLog> await store.topChangeLog();
    expect(log).toEqual({
      id: log.id,
      type: "newFile",
      contents: fileContents,
      file: {file: fileName, project: projName},
      checksum: md5(fileContents)
    });
  });

  it("Write to the same file mutiple times should leave a single editFile change", async () => {
    await store.writeFile(fileID, `${fileContents}_1`);
    await store.writeFile(fileID, `${fileContents}_2`);
    await store.writeFile(fileID, `${fileContents}_3`);
    let top;
    top = await store.popChangeLog();
    expect(top).toEqual({
      id: top.id,
      type: "editFile",
      file: {file: fileName, project: projName},
      contents: `${fileContents}_3`,
      checksum: md5(fileContents)
    });
    top = await store.topChangeLog();
    expect(top).toEqual({
      id: top.id,
      type: "newFile",
      file: {file: fileName, project: projName},
      contents: `${fileContents}`,
      checksum: md5(fileContents)
    });
    await store.writeFile(fileID, fileContents);
  });

  it("renameFile: should push two changes", async () => {
    await store.clearChangeLogs();
    fileID = (await store.renameFile(fileID, `${fileName}_newname`)).id;
    let logs = await store.getChangeLogs();
    expect(logs.length).toEqual(2);
    expect(logs[0]).toEqual({
      id: logs[0].id,
      type: "deleteFile",
      file: {file: `${fileName}`, project: projName},
      checksum: md5(fileContents)
    });
    expect(logs[1]).toEqual({
      id: logs[1].id,
      type: "newFile",
      file: {file: `${fileName}_newname`, project: projName},
      contents: logs[1].contents,
      checksum: md5(fileContents)
    });
    fileID = (await store.renameFile(fileID, fileName)).id;
  });

  it("deleteFile: should push a change", async () => {
    await store.clearChangeLogs();
    await store.deleteFile(fileID);
    let logs = await store.getChangeLogs();
    expect(logs.length).toEqual(1);
    expect(logs[0]).toEqual({
      id: logs[0].id,
      type: "deleteFile",
      file: {file: `${fileName}`, project: projName},
      contents: logs[0].contents,
      checksum: md5(fileContents)
    });
  });

});
