/* Test-only stand-in for "react": the unit tests never render a component, but a few lib files import hooks by name
   (e.g. `import { useSyncExternalStore } from "react"`), and Node's ESM loader cannot see named exports of React's CommonJS build. */
export const useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();
export const useState = (v) => [typeof v === "function" ? v() : v, () => {}];
export const useEffect = () => {};
export const useLayoutEffect = () => {};
export const useRef = (v) => ({ current: v });
export const useMemo = (fn) => fn();
export const useCallback = (fn) => fn;
export const useContext = () => null;
export const createContext = (v) => ({ Provider: () => null, Consumer: () => null, _v: v });
export const memo = (c) => c;
export default { useSyncExternalStore, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, createContext, memo };
