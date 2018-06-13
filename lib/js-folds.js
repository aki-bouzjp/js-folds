'use babel';

import { CompositeDisposable, File, Directory, Range, Point } from 'atom';

export default new class JsFolds {
  constructor() {
    // atom
    this.subscriptions = null;

    // log view
    this.jsFolderView  = null;

    // js-folds
    this.initialized        = false;
    this.configFile         = null;   // configのfileインスタンス
    this.config             = null;   // configのjson
    this.foldsPropatiesFile = null;   // folds propatyのfileインスタンス
    this.foldsPropaties     = null;   // folds propatyのjson
    this.foldsFiles         = null;   // foldsのfileインスタンス配列
    this.folds              = null;   // foldsのjson配列
  }

  // plugin開始時に実行される
  activate(state) {
    // Subscribeの生成
    this.subscriptions = new CompositeDisposable();

    // 設定ファイルの初期化
    const { readConfig, readFoldsPropaties } = this.initFolds();
    let readFolds = [];

    this.readInitialFile(readConfig, readFoldsPropaties);
  }

  // pluginクローズ時に実行される
  deactivate() {
    if (this.initialized) {
      this.readEditorFolds();
      this.saveFolds();
    }
    this.subscriptions.dispose();
  }

  // 定期的に操作をトリガーとして実行される
  serialize() {
    if (this.initialized) {
      this.readEditorFolds();
      this.saveFolds();
    }
  }

  // foldsの初期化
  initFolds() {
    let path = atom.project.getPaths();
    let dict = new Directory(`${path}/.js-folds`);

    // .js-folderのディレクトリと必要ファイルが存在する場合は続行
    if (dict.existsSync()) {
      return {
        readConfig         : this.getConfigFile(),
        readFoldsPropaties : this.getFoldsPropatiesFile(),
      };
    } else {
      // フォルダが存在しない
      atom.notifications.addError('There is no .js-folds directory. Please check in project directory.');
      return {
        readConfig         : false,
        readFoldsPropaties : false,
      }
    }
  }

  // プラグインの初期化
  initPlugin() {
    // 既に開いているエディタにfoldsの適用
    atom.workspace.observeTextEditors((editor) => {
      // エディタのfoldsの適用
      this.openEditorFolds(editor);
    });

    // エディタの開く検知
    this.subscriptions.add(atom.workspace.observeTextEditors((editor) => {
      let uri = editor.getPath();

      // エディタのfoldsの適用
      this.openEditorFolds(editor);

      // ファイル名の変更
      editor.onDidChangePath((newPath) => {
        if (typeof newPath !== string) { return; }
        // 新しいパスに入れ替えて、古いパスの情報を削除
        this.folds[newPath] = this.folds[path];
        delete this.folds[path];
        // ファイルへ書出し
        this.saveFolds();
      });
    }));

    // エディタの閉じる検知
    this.subscriptions.add(atom.workspace.onDidDestroyPaneItem((event) => {
      // ファイルへ書出し
      this.saveFolds();
    }));
  }

  // .js-folds/config.json の File インスタンスを取得
  getConfigFile() {
    try {
      let path = atom.project.getPaths();
      this.configFile = new File(`${path}/.js-folds/config.json`);

      // config.jsの存在を確認
      if (this.configFile.existsSync()) {
        return this.configFile.read();
      // config.json が存在しない場合は空のファイルを作成して {} を return する
      } else {
        this.configFile.write(`{}`);
        return {}
      }
    } catch(e) {
      atom.notifications.addError(e.toString());
      return false;
    }
  }

  // .js-folds/foldsPropaties.json の File インスタンスを取得
  getFoldsPropatiesFile() {
    try {
      let path = atom.project.getPaths();
      this.foldsPropatiesFile = new File(`${path}/.js-folds/foldsPropaties.json`);

      // foldsPropaties.json の存在を確認
      if (this.foldsPropatiesFile.existsSync()) {
        return this.foldsPropatiesFile.read();
      // foldsPropaties.json が存在しない場合は空のファイルを作成して {} を return する
      } else {
        this.foldsPropatiesFile.write(`{}`);
        return {};
      }
    } catch(e) {
      atom.notifications.addError(e.toString());
      return false;
    }
  }

  // .js-folds/xxxx.json の File インスタンス配列を取得
  getFoldsFiles() {
    try {
      let path = atom.project.getPaths();
      let readFolds = {};
      this.foldsFiles = {};

      const uris = Object.keys(this.foldsPropaties);

      uris.forEach((uri) => {
        const id = this.foldsPropaties[uri];

        const foldsFile = new File(`${path}/.js-folds/${id}.json`);
        this.foldsFiles[id] = foldsFile;

        // xxxx.json の存在を確認
        if (foldsFile.existsSync()) {
          readFolds[id] = foldsFile.read();
        }
      });
      return readFolds;
    } catch(e) {
      // エラー表示
      atom.notifications.addError(e.toString());
      return false;
    }
  }

  // .js-folds/config.json と .js-folds/foldsPropaties.json の読込み
  readInitialFile(readConfig, readFoldsPropaties) {
    if (readConfig && readFoldsPropaties) {
      Promise
        .all([readConfig, readFoldsPropaties])
        .then((initRes) => {
          // configの取得
          this.config = JSON.parse(initRes[0]);
          // foldsPropatiesの取得と整形
          this.foldsPropaties = JSON.parse(initRes[1]);
          // foldsFilesの取得と整形
          readFolds = this.getFoldsFiles();
          // foldsFilesのPromise配列を生成
          const ids = Object.keys(readFolds);
          const readFoldsFiles = ids.map((id) => {
            return readFolds[id];
          });

          // .js-folds/xxxx.jsonの読込み完了後の処理
          this.readFoldsFiles(readFoldsFiles, ids);
        })
        /*.catch((e) => {
          atom.notifications.addError(e.toString());
        });*/
    }
  }

  // .js-folds/xxxx.json の読込み
  readFoldsFiles(readFoldsFiles, ids) {
    if (readFoldsFiles.length) {
      Promise
        .all(readFoldsFiles)
        .then((foldsRes) => {
          // foldsの初期化
          this.folds = {};
          // foldsの取得と整形
          foldsRes.forEach((foldStr, i) => {
            this.folds[ids[i]] = this.convertFoldsFromString(foldStr);
          });
          // プラグイン初期化
          this.initPlugin();
          // フラグをオン
          this.initialized = true;
        })
        /*.catch((e) => {
          atom.notifications.addError(e.toString());
        });*/
    } else {
      // foldsの初期化
      this.folds = {};
      // プラグイン初期化
      this.initPlugin();
      // フラグをオン
      this.initialized = true;
    }
  }

  // stringからfoldsに変換
  convertFoldsFromString(foldStr) {
    let folds = [];
    let foldsJson = JSON.parse(foldStr);
    foldsJson.forEach((foldJson) => {
      const { start, end } = foldJson;
      const startPoint = new Point(start.row, start.column);
      const endPoint   = new Point(end.row,   end.column);
      let range = new Range(startPoint, endPoint);
      folds.push(range);
    });
    return folds;
  }

  // foldsからstringに変換
  convertFoldsToString(folds) {
    let foldsStr = `[`;
    folds.forEach((fold, i) => {
      if (!fold instanceof Range) { return '{}'; }
      const { start, end } = fold;
      foldsStr += `{`;
      foldsStr += `"start":{"row":${start.row}, "column":${start.column}},`;
      foldsStr += `"end":{"row":${end.row}, "column":${end.column}}`;
      foldsStr += `}`;
      if (folds.length !== i + 1) {
        foldsStr += `,`;
      }
    });
    foldsStr += `]`;
    // foldsが空なら{}にする
    if (!foldsStr.length) {
      foldsStr += `[]`;
    }
    return foldsStr;
  }

  // エディタのfoldsの適用
  openEditorFolds(editor) {
    const editorUri = editor.getURI();

    if (!editorUri) { return; }

    // idを走査
    let id;
    const uris = Object.keys(this.foldsPropaties);
    uris.forEach((uri) => {
      if (editorUri === uri) {
        id = this.foldsPropaties[uri];
      }
    });

    if (!id) { return; }

    // foldsの適用
    if (id in this.folds) {
      let folds = this.folds[id]
      if (folds) {
        folds.map((fold) => {
          editor.foldBufferRange(fold);
        });
      }
    }
  }

  // エディタのfoldsを洗い出し
  readEditorFolds() {
    atom.workspace.textEditorRegistry.editors.forEach((editor) => {
      const buffer = editor.getBuffer();
      if (!buffer) { return; }

      const displayLayer = buffer.getDisplayLayer(0);
      if (!displayLayer) { return; }

      const uri = editor.getURI()
      if (!uri) { return; }

      let id = this.foldsPropaties[uri];
      if (!id) {
        id = Math.random().toString(36).slice(-1 * 8);
        this.foldsPropaties[uri] = id;
      }

      const foldsByMarkerId = displayLayer.foldsMarkerLayer.markersById;

      const folds = [];
      for (const markerId in foldsByMarkerId) {
        const fold = foldsByMarkerId[markerId];
        const range = fold.getRange();
        // 重複するRangeが存在しなければリストに追加
        if (!this.checkDupeFolds(folds, range)) {
          folds.push(range);
        }
      }

      if (folds.length > 0) {
        this.folds[id] = folds;
      } else {
        this.folds[id] = [];
      }
    });
  }

  // Rangeの重複確認
  checkDupeFolds(folds, range) {
    return folds.some((fold) => {
      // 型の確認
      if (!fold instanceof Range) { return false; }
      if (fold.start.row === range.start.row &&
          fold.start.column === range.start.column &&
          fold.end.row === range.end.row &&
          fold.end.column === range.end.column
      ) {
        return true;
      }
    });
  }

  // .js-folds/folds.jsonの書込み
  saveFolds() {
    let foldsPropaties = `{`;
    const uris = Object.keys(this.foldsPropaties);
    uris.forEach((uri, i) => {
      // xxxx.jsonのファイル名（id）の作成、もしくは取得
      let id = this.foldsPropaties[uri];

      // foldsPropatiesを書込み
      foldsPropaties += `"${uri}": "${id}"`;
      // 最後でなければ , を挿入
      if (i !== uris.length - 1) {
        foldsPropaties += `,`;
      }

      // foldsの整形
      let folds = this.folds[id];
      let foldsStr = `[]`;

      if (folds) {
        // foldsからstringに変換
        foldsStr = this.convertFoldsToString(folds);
      }

      if (id in this.foldsFiles) {
        const foldsFile = this.foldsFiles[id];
        foldsFile.write(foldsStr);
      } else {
        let path = atom.project.getPaths();
        const foldsFile = new File(`${path}/.js-folds/${id}.json`);
        foldsFile.write(foldsStr);
        this.foldsFiles[id] = foldsFile;
      }
    });
    foldsPropaties += `}`;
    // .js-folds/folds.jsonの書込み
    this.foldsPropatiesFile.write(foldsPropaties);
  }
};
