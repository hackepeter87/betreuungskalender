import {
  Component,
  Suspense,
  lazy,
  useMemo,
  type ComponentType,
  type ErrorInfo,
  type ReactNode
} from "react";
import { useI18n } from "../i18n/I18nProvider";
import { Icon } from "./Icon";

export type DeferredPageLoader<Props extends object> = () => Promise<{
  default: ComponentType<Props>;
}>;

interface DeferredContentProps<Props extends object> {
  componentProps: Props;
  loader: DeferredPageLoader<Props>;
  pageId: string;
  variant: "page" | "dialog";
}

interface DeferredPageErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface DeferredPageErrorBoundaryState {
  failed: boolean;
}

class DeferredPageErrorBoundary extends Component<
  DeferredPageErrorBoundaryProps,
  DeferredPageErrorBoundaryState
> {
  state: DeferredPageErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): DeferredPageErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The user-facing state is intentionally generic. Chunk URLs and browser
    // error details must not become application logs.
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function DeferredContent<Props extends object>({
  componentProps,
  loader,
  pageId,
  variant
}: DeferredContentProps<Props>) {
  const { t } = useI18n();
  const Page = useMemo(() => lazy(loader), [loader]);
  const stateClassName = variant === "page"
    ? "panel empty-state deferred-page-state"
    : "empty-state deferred-dialog-state";

  return (
    <DeferredPageErrorBoundary
      key={`${variant}:${pageId}`}
      fallback={(
        <div
          className={stateClassName}
          role="alert"
          data-testid={`deferred-page-error-${pageId}`}
        >
          <Icon name="alert" size={24} />
          <h1>{t("status.pageLoadFailed")}</h1>
          <p>{t("status.pageLoadFailedDescription")}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => window.location.reload()}
          >
            {t("action.reloadApp")}
          </button>
        </div>
      )}
    >
      <Suspense
        fallback={(
          <div
            className={stateClassName}
            role="status"
            aria-live="polite"
            data-testid={`deferred-page-loading-${pageId}`}
          >
            <Icon name="history" size={24} />
            <p>{t("status.loadingPage")}</p>
          </div>
        )}
      >
        <Page {...componentProps} />
      </Suspense>
    </DeferredPageErrorBoundary>
  );
}

export function DeferredPage<Props extends object>(
  props: Omit<DeferredContentProps<Props>, "variant">
) {
  return <DeferredContent {...props} variant="page" />;
}

export function DeferredDialogContent<Props extends object>(
  props: Omit<DeferredContentProps<Props>, "variant">
) {
  return <DeferredContent {...props} variant="dialog" />;
}
