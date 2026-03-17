export const CONFIG_STORE_NAME = 'config';

import { IndexedDBStore } from './database';
import { useState, useEffect } from 'react';

class ConfigStore extends IndexedDBStore {
  async set(key, value) {
    return await this.put({ key, value });
  }

  async getValue(key) {
    const result = await this.get(key);
    return result?.value;
  }

  async getFull() {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = (event) => {
        const allConfigs = event.target.result.reduce((acc, { key, value }) => {
          acc[key] = value;
          return acc;
        }, {});
        resolve(allConfigs);
      };

      request.onerror = (event) => {
        reject('Get full error: ' + event.target.errorCode);
      };
    });
  }
}

export const config = new ConfigStore(CONFIG_STORE_NAME);

export const useConfig = (key) => {
  const [loading, setLoading] = useState(true);
  const [currentValue, setConfigValue] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchConfig = async () => {
      const value = await config.getValue(key);
      if (!cancelled) {
        setConfigValue(value);
        setLoading(false);
      }
    };

    setLoading(true);
    fetchConfig();
    config.eventEmitter.subscribe(key, fetchConfig);

    return () => {
      cancelled = true;
      config.eventEmitter.unsubscribe(key, fetchConfig);
    };
  }, [key]);

  const setConfig = async (value) => {
    setConfigValue(value);
    return await config.set(key, value);
  };

  return [currentValue, setConfig, loading];
};
