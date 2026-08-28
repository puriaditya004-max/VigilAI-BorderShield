# k3s

K3s manifests for remote BOP edge cluster deployment.

Use the Kubernetes manifests from `deploy/kubernetes/` for a single-node k3s pilot, then replace the simulator command in the `vigilai-edge-bridge` image with the real RTSP/USB producer command for field hardware. Keep camera credentials in Kubernetes Secrets or environment-backed `streamUriRef` values, not in committed camera JSON.
