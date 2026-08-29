import { useEffect, useState } from "react";
import { evidenceAssetUrl, operatorHeaders, type OperatorContext } from "../api";

interface AuthenticatedAssetState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

export function useAuthenticatedAssetUrl(assetUrl: string | undefined, operator: OperatorContext): AuthenticatedAssetState {
  const [state, setState] = useState<AuthenticatedAssetState>({ url: null, loading: false, error: null });

  useEffect(() => {
    if (!assetUrl) {
      setState({ url: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, loading: true, error: null });

    async function loadAsset() {
      try {
        const requestUrl = evidenceAssetUrl(assetUrl);
        const response = await fetch(requestUrl, {
          headers: operatorHeaders(operator)
        });
        if (!response.ok) throw new Error(`${requestUrl} ${response.status}`);

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setState({ url: objectUrl, loading: false, error: null });
      } catch (error) {
        if (!cancelled) {
          setState({
            url: null,
            loading: false,
            error: error instanceof Error ? error.message : "asset load failed"
          });
        }
      }
    }

    void loadAsset();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetUrl, operator.operatorId, operator.role, operator.token]);

  return state;
}
