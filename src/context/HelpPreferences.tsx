import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

const storageKey = "betreuungskalender.helpIconsVisible";

type HelpPreferencesContextValue = {
  helpIconsVisible: boolean;
  setHelpIconsVisible: (visible: boolean) => void;
};

const HelpPreferencesContext = createContext<HelpPreferencesContextValue | null>(null);

function readInitialVisibility() {
  try {
    return window.localStorage.getItem(storageKey) !== "false";
  } catch {
    return true;
  }
}

export function HelpPreferencesProvider({ children }: { children: ReactNode }) {
  const [helpIconsVisible, setHelpIconsVisibleState] = useState(readInitialVisibility);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, helpIconsVisible ? "true" : "false");
    } catch {
      // Local UI preferences are optional; the app remains usable without persistence.
    }
  }, [helpIconsVisible]);

  const value = useMemo<HelpPreferencesContextValue>(
    () => ({
      helpIconsVisible,
      setHelpIconsVisible: setHelpIconsVisibleState
    }),
    [helpIconsVisible]
  );

  return (
    <HelpPreferencesContext.Provider value={value}>
      {children}
    </HelpPreferencesContext.Provider>
  );
}

export function useHelpPreferences() {
  const context = useContext(HelpPreferencesContext);
  if (!context) {
    throw new Error("useHelpPreferences must be used within HelpPreferencesProvider");
  }
  return context;
}
