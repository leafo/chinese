export const DB_NAME = 'chinese';

let db;

export const MIGRATIONS = [
  (db) => {
    db.createObjectStore("config", { keyPath: 'key' });
  },
  (db) => {
    const words = db.createObjectStore("words", { keyPath: 'id', autoIncrement: true });
    words.createIndex("by_simplified", "simplified", { unique: false });
    words.createIndex("by_traditional", "traditional", { unique: false });

    db.createObjectStore("collections", { keyPath: 'id', autoIncrement: true });
  },
  (db) => {
    db.createObjectStore("audio_clips", { keyPath: "text" });
  },
  (db) => {
    const reviews = db.createObjectStore("flashcard_reviews", { keyPath: "key" });
    reviews.createIndex("by_dueDate", "dueDate", { unique: false });
    reviews.createIndex("by_wordId", "wordId", { unique: false });
  },
];

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, MIGRATIONS.length);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const transaction = event.target.transaction;

      for (let i = event.oldVersion; i < event.newVersion; i++) {
        console.log(`Migrating from ${i} to ${i + 1}`);
        const migration = MIGRATIONS[i];

        if (!migration) {
          reject(new Error(`Migration ${i} is not defined`));
        }

        migration(db, transaction);
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;

      db.onversionchange = event => {
        console.debug("Database version changed", event);
        db.close();
      };

      resolve(db);
    };

    request.onerror = (event) => {
      reject(`Database error: ${event.target.errorCode}`);
    };
  });
}

export function resetAll() {
  return new Promise((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
    deleteRequest.onsuccess = () => {
      resolve(openDatabase());
    };
    deleteRequest.onerror = () => {
      reject(new Error("Failed to delete database"));
    };
    deleteRequest.onblocked = () => {
      reject(new Error("Failed to delete database: Database is blocked"));
    };
  });
}

export class StoreEventEmitter {
  constructor() {
    this.listeners = {};
  }

  subscribe(key, callback) {
    if (!this.listeners[key]) {
      this.listeners[key] = [];
    }
    this.listeners[key].push(callback);
  }

  unsubscribe(key, callback) {
    if (this.listeners[key]) {
      this.listeners[key] = this.listeners[key].filter(cb => cb !== callback);
    }
  }

  emit(key, value) {
    [key, '*'].forEach(key => {
      if (this.listeners[key]) {
        this.listeners[key].forEach(callback => callback(value));
      }
    });
  }
}

export class IndexedDBStore {
  constructor(storeName, rowConstructor = null) {
    this.storeName = storeName;
    this.rowConstructor = rowConstructor;
    this.eventEmitter = new StoreEventEmitter();
    this.getDb();
  }

  async getDb() {
    if (this.db) return this.db;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = openDatabase();
    this.db = await this.loadPromise;

    delete this.loadPromise;
    return this.db;
  }

  transformRow(data) {
    if (!data) return data;
    return this.rowConstructor ? new this.rowConstructor(data) : data;
  }

  async get(key) {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = (event) => {
        resolve(this.transformRow(event.target.result));
      };

      request.onerror = (event) => {
        reject(new Error(`'${this.storeName}': Get error ${event.target.errorCode}`));
      };
    });
  }

  async getAll() {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = (event) => {
        resolve(event.target.result.map(row => this.transformRow(row)));
      };

      request.onerror = (event) => {
        reject(new Error(`'${this.storeName}': GetAll error ${event.target.errorCode}`));
      };
    });
  }

  async add(value) {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.add(value);

      request.onsuccess = () => {
        const newKey = request.result;
        this.eventEmitter.emit(newKey, value);
        resolve(request.result);
      };

      request.onerror = (event) => {
        reject(new Error(`'${this.storeName}': Failed to add value ${event.target.errorCode}`));
      };
    });
  }

  async put(value) {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(value);

      request.onsuccess = () => {
        this.eventEmitter.emit(request.result, value);
        resolve(true);
      };

      request.onerror = (event) => {
        reject(new Error(`'${this.storeName}': Set error ${event.target.errorCode}`));
      };
    });
  }

  async putMany(values) {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      for (const value of values) {
        store.put(value);
      }

      transaction.oncomplete = () => {
        this.eventEmitter.emit(null, null);
        resolve(true);
      };

      transaction.onerror = (event) => {
        reject(new Error(`'${this.storeName}': PutMany error ${event.target.errorCode}`));
      };
    });
  }

  async remove(key) {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);

      request.onsuccess = () => {
        this.eventEmitter.emit(key, null);
        resolve(true);
      };

      request.onerror = (event) => {
        reject(new Error(`'${this.storeName}': Remove error ${event.target.errorCode}`));
      };
    });
  }

  async queryOrderedDesc(limit, offset) {
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);

      const request = store.openCursor(null, 'prev');
      const results = [];
      let currentIndex = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && currentIndex < offset + limit) {
          if (currentIndex >= offset) {
            results.push(this.transformRow(cursor.value));
          }
          currentIndex++;
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = (event) => {
        reject(new Error(`'${this.storeName}': Query error ${event.target.errorCode}`));
      };
    });
  }
}
