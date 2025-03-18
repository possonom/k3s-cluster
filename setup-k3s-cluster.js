#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load configuration from external file
const config = require('./config.js');

// Export config for use in other scripts
module.exports = { config };

// Create directory structure
console.log('Creating directory structure...');
const dirs = [
  'manifests',
  'scripts',
  'configs',
  'certs'
];

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Generate SSH key for cluster communication
console.log('Generating SSH key for cluster communication...');
if (!fs.existsSync('certs/id_rsa')) {
  execSync('ssh-keygen -t rsa -b 4096 -f certs/id_rsa -N ""');
}

// Create scripts for node setup
console.log('Creating node setup scripts...');

// Base node setup script
fs.writeFileSync('scripts/base-node-setup.sh', `#!/bin/bash
set -e

# Update system
apt-get update
apt-get upgrade -y

# Install dependencies
apt-get install -y curl wget vim htop iptables nfs-common

# Set up firewall
ufw allow ssh
ufw allow from 10.0.0.0/9
ufw --force enable

# Configure sysctl for Kubernetes
cat > /etc/sysctl.d/k8s.conf << EOF
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1
EOF

sysctl --system

# Disable swap
swapoff -a
sed -i '/swap/d' /etc/fstab

# Set hostname
hostnamectl set-hostname \${HOSTNAME}

# Add hosts entries
cat >> /etc/hosts << EOF
10.0.1.1 manager-1
10.0.1.2 manager-2
10.0.1.3 manager-3
10.0.2.1 worker-1
10.0.2.2 worker-2
10.0.3.1 db-1
10.0.3.2 db-2
10.0.4.1 msg-1
10.0.4.2 msg-2
10.128.0.1 jump-host
EOF

# Set up routing through jump host
ip route add default via 10.128.0.1
`);

// K3s master node setup script
fs.writeFileSync('scripts/setup-master.sh', `#!/bin/bash
set -e

# Install K3s server
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${config.k3s.version}" sh -s - server \\
  --token=${config.k3s.token} \\
  --tls-san=\${NODE_IP} \\
  --node-ip=\${NODE_IP} \\
  --advertise-address=\${NODE_IP} \\
  --flannel-iface=eth1 \\
  --disable=traefik \\
  --disable=servicelb \\
  --cluster-init

# Wait for K3s to be ready
sleep 10

# Copy kubeconfig for easier access
mkdir -p /home/ubuntu/.kube
cp /etc/rancher/k3s/k3s.yaml /home/ubuntu/.kube/config
sed -i "s/127.0.0.1/\${NODE_IP}/g" /home/ubuntu/.kube/config
chown -R ubuntu:ubuntu /home/ubuntu/.kube
`);

// K3s additional master nodes setup script
fs.writeFileSync('scripts/setup-additional-master.sh', `#!/bin/bash
set -e

# Install K3s server
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${config.k3s.version}" sh -s - server \\
  --token=${config.k3s.token} \\
  --tls-san=\${NODE_IP} \\
  --node-ip=\${NODE_IP} \\
  --advertise-address=\${NODE_IP} \\
  --flannel-iface=eth1 \\
  --disable=traefik \\
  --disable=servicelb \\
  --server https://10.0.1.1:6443

# Wait for K3s to be ready
sleep 10

# Copy kubeconfig for easier access
mkdir -p /home/ubuntu/.kube
cp /etc/rancher/k3s/k3s.yaml /home/ubuntu/.kube/config
sed -i "s/127.0.0.1/\${NODE_IP}/g" /home/ubuntu/.kube/config
chown -R ubuntu:ubuntu /home/ubuntu/.kube
`);

// K3s worker node setup script
fs.writeFileSync('scripts/setup-worker.sh', `#!/bin/bash
set -e

# Install K3s agent
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${config.k3s.version}" K3S_URL=https://10.0.1.1:6443 K3S_TOKEN=${config.k3s.token} sh -s - agent \\
  --node-ip=\${NODE_IP} \\
  --flannel-iface=eth1
`);

// Create Kubernetes manifests
console.log('Creating Kubernetes manifests...');

// Longhorn storage class
fs.writeFileSync('manifests/longhorn.yaml', `apiVersion: v1
kind: Namespace
metadata:
  name: longhorn-system
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: longhorn
  namespace: kube-system
spec:
  chart: longhorn
  repo: https://charts.longhorn.io
  targetNamespace: longhorn-system
  valuesContent: |-
    defaultSettings:
      defaultReplicaCount: 3
      createDefaultDiskLabeledNodes: true
    persistence:
      defaultClassReplicaCount: 3
    ingress:
      enabled: false
`);

// Hetzner CSI driver
fs.writeFileSync('manifests/hetzner-csi.yaml', `apiVersion: v1
kind: Secret
metadata:
  name: hcloud-csi
  namespace: kube-system
stringData:
  token: "${config.hetzner.apiToken}"
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: hcloud-csi
  namespace: kube-system
spec:
  chart: hcloud-csi
  repo: https://charts.hetzner.cloud
  targetNamespace: kube-system
  valuesContent: |-
    controller:
      enabled: true
    node:
      enabled: true
    secret:
      existingSecret: hcloud-csi
`);

// NFS provisioner for Hetzner Storage Box
fs.writeFileSync('manifests/nfs-provisioner.yaml', `apiVersion: v1
kind: Namespace
metadata:
  name: nfs-provisioner
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: nfs-subdir-external-provisioner
  namespace: kube-system
spec:
  chart: nfs-subdir-external-provisioner
  repo: https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner
  targetNamespace: nfs-provisioner
  valuesContent: |-
    nfs:
      server: ${config.storage.storageBox.nfsServer}
      path: ${config.storage.storageBox.nfsPath}
    storageClass:
      name: nfs-storageclass
      defaultClass: false
      reclaimPolicy: Retain
`);

// Hetzner Load Balancer Controller
fs.writeFileSync('manifests/hetzner-lb-controller.yaml', `apiVersion: v1
kind: Secret
metadata:
  name: hcloud-lb
  namespace: kube-system
stringData:
  token: "${config.hetzner.apiToken}"
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: hcloud-cloud-controller-manager
  namespace: kube-system
spec:
  chart: hcloud-cloud-controller-manager
  repo: https://charts.hetzner.cloud
  targetNamespace: kube-system
  valuesContent: |-
    networking:
      enabled: true
      networkID: "${config.hetzner.networkId}"
    secret:
      existingSecret: hcloud-lb
`);

// S3 backup configuration
fs.writeFileSync('manifests/s3-backup.yaml', `apiVersion: v1
kind: Secret
metadata:
  name: s3-backup-credentials
  namespace: kube-system
stringData:
  accessKey: "${config.storage.objectStorage.accessKey}"
  secretKey: "${config.storage.objectStorage.secretKey}"
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: velero
  namespace: kube-system
spec:
  chart: velero
  repo: https://vmware-tanzu.github.io/helm-charts
  targetNamespace: velero
  valuesContent: |-
    configuration:
      provider: aws
      backupStorageLocation:
        name: default
        bucket: ${config.storage.objectStorage.bucketName}
        config:
          region: ${config.storage.objectStorage.region}
          s3ForcePathStyle: true
          s3Url: https://${config.storage.objectStorage.endpoint}
      volumeSnapshotLocation:
        name: default
        config:
          region: ${config.storage.objectStorage.region}
    credentials:
      existingSecret: s3-backup-credentials
    initContainers:
      - name: velero-plugin-for-aws
        image: velero/velero-plugin-for-aws:v1.5.0
        volumeMounts:
          - mountPath: /target
            name: plugins
`);

// Node labels and taints
fs.writeFileSync('manifests/node-labels.yaml', `apiVersion: v1
kind: ConfigMap
metadata:
  name: node-labels
  namespace: kube-system
data:
  apply-labels.sh: |
    #!/bin/bash
    
    # Label and taint database nodes
    kubectl label nodes db-1 db-2 node-role.kubernetes.io/database=true
    kubectl taint nodes db-1 db-2 dedicated=database:NoSchedule
    
    # Label and taint messaging nodes
    kubectl label nodes msg-1 msg-2 node-role.kubernetes.io/messaging=true
    kubectl taint nodes msg-1 msg-2 dedicated=messaging:NoSchedule
    
    # Label worker nodes
    kubectl label nodes worker-1 worker-2 node-role.kubernetes.io/worker=true
`);

// Make scripts executable
console.log('Making scripts executable...');
fs.chmodSync('setup-k3s-cluster.js', '755');

console.log('Setup completed successfully!');
console.log('Please update the configuration in config.js before running deploy-k3s-cluster.js');
