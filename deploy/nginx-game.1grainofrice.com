# /etc/nginx/sites-available/game.1grainofrice.com
# Dedicated subdomain for RiceDAO. RiceDAO is a Next.js app with
# basePath=/RiceDAO whose code ALSO emits root-relative public asset paths
# (/assets, /landing, /memes, /pfp, /pfp-assets, /charity, /lore, /icon.svg).
# Giving it its own hostname means it owns this subdomain's root, so those paths
# no longer collide with the $RICE site at 1grainofrice.com.
#
# These blocks are lifted verbatim from the old ip-rice IP gateway (which is
# being retired). `certbot --nginx` adds the listen 443 ssl block + redirect.

server {
    listen 80;
    listen [::]:80;
    server_name game.1grainofrice.com;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Bare root -> the app (RiceDAO is mounted under /RiceDAO via basePath).
    location = / {
        return 302 /RiceDAO/;
    }

    # Normalize the no-trailing-slash form.
    location = /RiceDAO {
        proxy_pass http://127.0.0.1:1111;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # --- RiceDAO API (Express) ---
    # Strips /RiceDAO/api -> upstream root (client base = /RiceDAO/api):
    #   /RiceDAO/api/health   -> 127.0.0.1:1112/health
    #   /RiceDAO/api/api/town -> 127.0.0.1:1112/api/town
    location ^~ /RiceDAO/api/ {
        client_max_body_size 20m;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_pass http://127.0.0.1:1112/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # --- RiceDAO web (Next.js, basePath=/RiceDAO) ---
    # No trailing slash on proxy_pass: keep the /RiceDAO/ prefix intact so it
    # matches the app's basePath (assets live at /RiceDAO/_next/...).
    location ^~ /RiceDAO/ {
        proxy_pass http://127.0.0.1:1111;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # --- RiceDAO root-relative public asset shims ---
    # RiceDAO code references /assets/..., /landing/..., etc. at the root while
    # the app is mounted at /RiceDAO. On its own subdomain these no longer clash
    # with anything, so they simply forward to the app's /RiceDAO/... assets.
    location ^~ /assets/      { proxy_pass http://127.0.0.1:1111/RiceDAO/assets/;      proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
    location ^~ /landing/     { proxy_pass http://127.0.0.1:1111/RiceDAO/landing/;     proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
    location ^~ /memes/       { proxy_pass http://127.0.0.1:1111/RiceDAO/memes/;       proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
    location ^~ /charity/     { proxy_pass http://127.0.0.1:1111/RiceDAO/charity/;     proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
    location ^~ /lore/        { proxy_pass http://127.0.0.1:1111/RiceDAO/lore/;        proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
    location ^~ /pfp-assets/  { proxy_pass http://127.0.0.1:1111/RiceDAO/pfp-assets/;  proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
    location ^~ /pfp/         { proxy_pass http://127.0.0.1:1111/RiceDAO/pfp/;         proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
    location = /icon.svg      { proxy_pass http://127.0.0.1:1111/RiceDAO/icon.svg;     proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
}
