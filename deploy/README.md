# Cerebro Deployment

## Setup on ubuntu-server1

```bash
# 1. Clone and build
cd /srv
git clone <repo-url> cerebro
cd cerebro
npm install
npm run build

# 2. Configure
cp .env.example .env
# Edit .env with real values

# 3. Start Docker services
docker-compose up -d

# 4. Bootstrap databases
npm run bootstrap

# 5. Install systemd service
sudo cp deploy/cerebro.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cerebro
sudo systemctl start cerebro

# 6. Install cron jobs
crontab deploy/crontab.example

# 7. Verify
curl http://localhost:3000/health
sudo systemctl status cerebro
```
