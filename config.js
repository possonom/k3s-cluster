// K3s Cluster Configuration
module.exports = {
  network: {
    privateSubnet: '10.0.0.0/9',
    jumpHost: {
      ip: '10.128.0.1',
    }
  },
  nodes: {
    managers: [
      { name: 'manager-1', ip: '10.0.1.1', ram: 4, cpu: 2 },
      { name: 'manager-2', ip: '10.0.1.2', ram: 4, cpu: 2 },
      { name: 'manager-3', ip: '10.0.1.3', ram: 4, cpu: 2 },
    ],
    workers: [
      { name: 'worker-1', ip: '10.0.2.1', ram: 4, cpu: 2 },
      { name: 'worker-2', ip: '10.0.2.2', ram: 4, cpu: 2 },
    ],
    database: [
      { name: 'db-1', ip: '10.0.3.1', ram: 8, cpu: 4 },
      { name: 'db-2', ip: '10.0.3.2', ram: 8, cpu: 4 },
    ],
    messaging: [
      { name: 'msg-1', ip: '10.0.4.1', ram: 4, cpu: 2 },
      { name: 'msg-2', ip: '10.0.4.2', ram: 4, cpu: 2 },
    ]
  },
  storage: {
    storageBox: {
      nfsServer: 'your-storage-box.your-storagebox.de',
      nfsPath: '/your-storage-box',
      size: '1TB'
    },
    objectStorage: {
      endpoint: 's3.hetzner.cloud',
      region: 'eu-central-1',
      bucketName: 'k3s-cluster-backup',
      accessKey: 'your-access-key',
      secretKey: 'your-secret-key'
    }
  },
  k3s: {
    version: 'v1.25.6+k3s1',
    token: 'your-secure-k3s-token'
  },
  hetzner: {
    apiToken: 'your-hetzner-api-token',
    networkId: 'your-hetzner-network-id'
  }
};
