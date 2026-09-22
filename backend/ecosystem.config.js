module.exports = {
  apps: [
    {
      name: 'sizing-portal',
      script: 'src/server.js',
      cwd: '/home/raarya/sizing-portal/backend',
      instances: 1,
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'folder-watcher',
      script: 'scripts/folder_watcher.py',
      cwd: '/home/raarya/sizing-portal/backend',
      interpreter: 'python3',
      instances: 1,
      autorestart: true,
      watch: false,
      restart_delay: 5000
    }
  ]
};
