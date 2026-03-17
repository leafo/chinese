import React from 'react';
import { useState, useEffect } from 'react';

function shallowCompare(obj1, obj2) {
  if (obj1 === obj2) return true;
  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) return false;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (!keys2.includes(key) || obj1[key] !== obj2[key]) return false;
  }

  return true;
}

function filterObject(obj, fields) {
  if (!fields) return obj;

  const filteredObj = {};
  for (const key of fields) {
    if (key in obj) {
      filteredObj[key] = obj[key];
    }
  }
  return shallowCompare(obj, filteredObj) ? obj : filteredObj;
}

export function useRoute(fields = null) {
  const [routeParams, setRouteParams] = useState(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const params = Object.fromEntries(queryParams.entries());
    return filterObject(params, fields);
  });

  useEffect(() => {
    const handlePopState = () => {
      const queryParams = new URLSearchParams(window.location.search);
      const newParams = filterObject(Object.fromEntries(queryParams.entries()), fields);
      if (!shallowCompare(routeParams, newParams)) {
        setRouteParams(newParams);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [routeParams, JSON.stringify(fields)]);

  return routeParams;
}

export function useRouteToggle(param) {
  const routeParams = useRoute([param]);

  const setParam = (value) => {
    updateRoute({ [param]: value });
  };

  return [!!routeParams[param], setParam];
}

export function updateRoute(newParams) {
  const queryParams = new URLSearchParams(window.location.search);
  for (const key in newParams) {
    if (newParams[key] === false) {
      queryParams.delete(key);
    } else {
      queryParams.set(key, newParams[key]);
    }
  }
  const newUrl = `${window.location.pathname}?${queryParams.toString()}`;
  window.history.pushState(null, '', newUrl);
  window.dispatchEvent(new CustomEvent('popstate'));
}

export function setRoute(newRouteParams) {
  const queryParams = new URLSearchParams();
  for (const key in newRouteParams) {
    queryParams.set(key, newRouteParams[key]);
  }
  const newUrl = `${window.location.pathname}?${queryParams.toString()}`;
  window.history.pushState(null, '', newUrl);
  window.dispatchEvent(new CustomEvent('popstate'));
}
