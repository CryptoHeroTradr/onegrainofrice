# Swapping memes

The meme wall has **two rows fed by the same list** ([src/config/memes.ts](../../src/config/memes.ts)):
row 1 is the static scattered collage, row 2 is the swipeable carousel.

## Drop in the real art

Save files with these names into this folder. **Cut-outs should be
transparent-background PNGs** so they float as stickers; the rice-fields one is
a rectangular photo.

```
biden-bowl.png            transparent cutout — Biden eating from a takeout box
gatsby-cheers.png         transparent cutout — DiCaprio tux, raising a bowl of rice
bowl-guy.png              transparent cutout — bearded man cradling a dark bowl
rice-cube.png             transparent cutout — Ice Cube, "RICE CUBE" jersey
mona-lisa.png             transparent cutout — Mona Lisa, chopsticks + bowl
heart-grain.png           transparent cutout — puffy translucent rice heart
rice-fields-brother.jpg   rectangular photo — green field, man crawling (banner in CSS)
```

Also for the other slots (in `public/`, not here):

```
hero-grain.png            transparent — single glowing grain above an open palm
impact-ricenburgh.jpg     B&W high-contrast — exploding airship "RICENBURGH"
```

**Until a real file exists, the app automatically falls back to the generated
`<id>.svg` placeholder** (via `src/lib/resolveAsset.ts`), so nothing 404s. After
dropping files in, rebuild (`pnpm build && pm2 restart onegrainofrice`) — the
resolver picks up the new files at build time.

## Or edit the config

Add/remove/reorder entries in `src/config/memes.ts` — one line each:
`{ id, src, alt, caption?, rotation?, photo? }`. Set `photo: true` for a
rectangular framed photo instead of a cut-out. Collage positions live in
`src/components/MemeCollage.tsx` (`LAYOUT`), keyed by `id`.

Regenerate placeholders anytime: `pnpm placeholders`.
