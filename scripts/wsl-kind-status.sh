#!/usr/bin/env bash
# Inspect the kind node's internal control-plane services.
set +e
export HOME="/home/$(whoami)"
export PATH="$HOME/.local/bin:$PATH"

echo "=== node systemd services ==="
docker exec video-platform-control-plane systemctl is-active containerd kubelet 2>&1

echo "=== control-plane containers (crictl) ==="
docker exec video-platform-control-plane crictl ps 2>/dev/null | grep -E 'kube-apiserver|etcd|kube-controller|kube-scheduler' || echo "(none running yet)"

echo "=== kubectl nodes ==="
kubectl get nodes 2>&1
