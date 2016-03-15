angular.module('seashell-local-files', [])
  /**
   * Local file storage service, using localforage.js
   * Interface is pretty much the same as websocket_client.js
   */
  .service('localfiles', ['$q', '$cookies',
    function($q, $cookies) {
      "use strict";
      var self = this;

      self.user = null;
      self.store = null;

      // Must call this before using anything
      self.init = function() {
        self.user = $cookies.getObject(SEASHELL_CREDS_COOKIE).user;

        // set up localforage to have a per-user store
        // note that this doesn't actually secure anything:
        // it only prevents name conflicts
        self.store = localforage.createInstance({
          name: self.user,
          version: 1.0
        });
      };


      /*
       * Returns the path to where this file is stored.
       */
      self._path = function(project, file) {
        return sprintf("%s/%s", project, file); 
      };

      /*
       * Save a file to local storage.
       * @param {string} name: project name
       * @param {string} file_name: filename
       * @param {string} file_content: The contents of the file
       * @param {string | false} checksum: MD5 checksum of the contents,
       *   or false for an offline-write
       */
      self.writeFile = function(name, file_name, file_content, checksum) {
        var offline_checksum = md5(file_content);
        var online_checksum;
        var path = self._path(name, file_name);

        // checksum is false when we're doing an offline write
        if (checksum === false) {
          $q.when(self.store.getItem(path)).then(
            function(contents) {
              online_checksum = contents.online_checksum;
            }
          );
        }

        var to_write = {
          data: file_content,
          online_checksum: checksum || online_checksum,
          offline_checksum: offline_checksum
        };
        console.log("[storage-service] Writing: ", to_write);
        return $q.when(self.store.setItem(path, to_write));
      };

      self.readFile = function(name, file_name) {
        return $q.when(self.store.getItem(self._path(name, file_name))).then(
          function(contents) {
            console.log("[storage-service] Reading", contents);
            return contents;
          });
      };


      self.renameFile = function(project, old_name, new_name) {
        self.readFile(project, old_name)
          .then(
            function(contents) {
              self.writeFile(project, new_name, contents.data, contents.online_checksum);
            })
          .then(
            function() {
              self.deleteFile(project, old_name);
            });
      };

      self.deleteFile = function(name, file_name) {
        console.log("[storage-service] deleteFile");
        return $q.when(self.store.removeItem(self._path(name, file_name)));
      };

      self.getRunnerFile = function(name, question) {
        return self.store.getItem(self._path(name, question) + "//runnerFile")
          .then(function(contents) {
            console.log("[storage-service] getRunnerFile", contents);
            return contents;
          });
      };

      self.setRunnerFile = function(name, question, folder, file) {
        if (folder == "common" || folder == "tests")
          return $q.reject("Runner file must be in question directory.");
        console.log("[storage-service] setRunnerFile");
        return $q.when(self.store.setItem(self._path(name, question) + "//runnerFile", file));
      };

      // Root is indexed by project
      // Projects are a flat list of directories and files
      // Paths are all relative to project
      // eg. "q3/tests/mytest.in" is a file
      // eg. "q3/tests/" is a directory 
      
      self._getTree = function() {
        return self.store.getItem("//tree")
        .then(function(tree) {
          return tree || {};
        });
      };

      self._setTree = function(tree) {
        return $q.when(self.store.setItem("//tree", tree));
      };

      // Creates a node. A node is either a file or a directory.
      self._newNode = function(project, path, is_dir) {
        // TODO
        return {}; 
      };

      self.newDirectory = function(name, dir_path) {
        self._getTree()
        .then(function(tree) {
          tree[name].children.push(self._newNode(name, dir_path, true));
        });
      };

      self.newFile = function(name, file_name, contents,
        encoding, normalize) {
        // TODO: decoding 
        // name: project name
        // file_name: relative path under project
        self._getTree()
        .then(function(tree) {
          tree[name].children.push(self._newNode(name, file_name, false)); 
          self._setTree(tree);
          self.writeFile(self.path(name, file_name), contents);
        }); 
      };

      self.getProjects = function() {
        return self._getTree()
        .then(function(tree) {
          return _.map(Object.keys(tree), function(project) {
            return [project, 0]; // TODO: timestamp?
          }); 
        });
      };

    }
  ]);
