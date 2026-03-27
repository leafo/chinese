import React from 'react';
import { useEffect, useRef } from 'react';

export function formatBytes(bytes) {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);

  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function useModalDialog() {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  return dialogRef;
}

export function useAsync(fn, inputs) {
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    setError(null);

    let isMounted = true;

    fn().then(result => {
      if (isMounted) {
        setLoading(false);
        setResult(result);
      }
    }).catch(result => {
      if (isMounted) {
        setLoading(false);
        setError(result);
      }
    });

    return () => {
      isMounted = false;
    };
  }, inputs);

  return [result, error, loading];
}
