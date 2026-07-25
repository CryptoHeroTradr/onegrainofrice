# /etc/nginx/sites-available/1grainofrice
# Dedicated domain for the $RICE site. Serves ONLY the onegrainofrice Next.js
# app (built at the true root, NEXT_PUBLIC_BASE_PATH=""), proxied to :3006, with
# the grains realtime WebSocket at /grains/ws -> :3007.
#
# The shared IP gateway (sites-available/ip-rice, default_server) still hosts
# CXMZ and RiceDAO by path, but this name-based vhost has NO routes to them, so
# they can never appear on 1grainofrice.com.
#
# Requires conf.d/geoip2.conf (http scope) for $geoip2_country_* — already
# installed. `certbot --nginx` adds the listen 443 ssl block + HTTP->HTTPS
# redirect on top of this.

server {
    listen 80;
    listen [::]:80;
    server_name 1grainofrice.com www.1grainofrice.com;

    # Let's Encrypt HTTP-01 challenges.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # --- grains realtime WebSocket (:3007). Longer prefix wins over "/". ---
    location ^~ /grains/ws {
        proxy_pass http://127.0.0.1:3007;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Country-Code $geoip2_country_code;
        proxy_set_header X-Country-Name $geoip2_country_name;
    }

    # --- the $RICE Next.js app at the root (:3006) ---
    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Country-Code $geoip2_country_code;
        proxy_set_header X-Country-Name $geoip2_country_name;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
