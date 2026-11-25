# HelloValley — Art prompts

Image-generation prompts for concept art, style references, textures, characters, icons and key art. The concept images guide the Blender Python generators ([build plan M04–M08, M32–M34](build-plan.md)). The texture and icon outputs ship in the game after cleanup.

Usage: replace `{{…}}`. Always append the **style anchor** and the **negative prompt**. Keep the seed fixed per series for consistency.

## 0. Style anchor and negative prompt

**Style anchor** (append to every prompt):
```text
cozy isometric 3D miniature diorama, stylized low-to-medium-poly geometry, detailed modular
architecture, pastel colour palette, soft ambient occlusion, warm golden-hour lighting, lush rounded
vegetation, toy-like proportions, subtle hand-painted textures, tilt-shift miniature feel, clean
readable silhouettes, game art, high detail
```

**Negative prompt:**
```text
photorealistic, gritty, dark, horror, noisy, oversaturated neon, harsh shadows, lens flare, text,
watermark, logo, signature, blurry, deformed, extra limbs, cluttered, realistic human faces,
copyrighted characters
```

---

## 1. Key art and marketing

**1.1 Hero key art**
```text
A tiny floating diorama island of a cozy village seen from an isometric angle: a pastel apartment
block, a bakery with steam rising, a town square with a fountain, benches and round trees, a little
river with a stone bridge and a wooden fishing dock, a library on a hill. Small humanized animal
villagers (fox, rabbit, capybara, red panda) chatting with colourful speech bubbles containing
greetings in many scripts (Hello, Hola, こんにちは, مرحبا, Bonjour). Soft sky background.
```

**1.2 Style-switch banner** (one image, 4 quadrants)
```text
The same small town square shown four times in a 2×2 grid, identical layout but different
architecture: top-left Central/Northern European half-timbered houses, top-right Mediterranean
whitewash and terracotta, bottom-left Arabic sand plaster with domes and arches, bottom-right
Japanese wooden houses with curved tile roofs and sakura.
```

**1.3 Loading screen tips background** (16:9, empty centre for text)
```text
Cozy wide shot of a riverside path at dusk with warm lanterns, fireflies and a fishing dock, a
calm empty area in the centre, soft bokeh.
```

---

## 2. Style sheets (reference for the generators)

One prompt per style. Generate 4–6 images each: a street view, a building close-up, a modular parts sheet and a palette.

**2.1 Central & Northern European**
```text
Modular building parts sheet for a cozy Central and Northern European village, laid out on a
neutral grid background: half-timbered wall segments, plain plaster walls in cream, butter and
sage, steep gable roofs with red clay and slate tiles, stepped gable, dormer windows, flower boxes
with red geraniums, wooden shutters, hanging iron shop signs, cobblestone tiles, linden and oak
trees with round canopies, street lamps, wooden benches. Orthographic isometric views, each part
separated.
```

**2.2 Mediterranean**
```text
Modular building parts sheet for a cozy Mediterranean coastal village: whitewashed and ochre stucco
walls, low-pitched terracotta roofs, arched doorways, blue and sage shutters, wrought-iron balconies,
wooden pergolas with bougainvillea and grapevines, terracotta pots, lemon trees, olive trees, slim
cypress trees, sun-bleached paving stones, a tiled fountain. Orthographic isometric views,
separated parts.
```

**2.3 Arabic**
```text
Modular building parts sheet for a cozy Arabic-inspired village: sand and rose plaster walls, flat
roofs with crenellated parapets, horseshoe and pointed arches, carved wooden mashrabiya window
screens, small white and turquoise domes, zellige mosaic tile accents in pastel teal and saffron,
arcades, brass lanterns, date palms, a courtyard fountain with an octagonal basin, woven awnings.
Orthographic isometric views, separated parts.
```

**2.4 Japanese**
```text
Modular building parts sheet for a cozy traditional Japanese village: dark wood frames and white
plaster walls, grey kawara tile roofs with gently curved eaves, engawa wooden verandas, shoji
sliding doors, noren fabric curtains in pastel indigo, stone lanterns, bamboo fences, a small
arched wooden bridge, cherry blossom trees, pine trees, maple trees, gravel and stepping-stone paths.
Orthographic isometric views, separated parts.
```

**2.5 Palette sheet** (per style)
```text
Colour palette swatch sheet for a {{style}} cozy diorama game: 12 large rounded swatches labelled
only by position, grouped as walls, roofs, trims, foliage, ground, accents. Pastel, warm, harmonious.
```

---

## 3. Building concepts (per NPC × style)

Template; run it for each of the 10 buildings × 4 styles:

```text
Isometric concept of a single small {{building}} in {{style}} style, on a square grass-and-path
diorama tile, 2 storeys, built from modular wall, window, door and roof pieces on a visible 1 m
grid rhythm. Character details: {{details}}. Warm interior light from windows. No people.
```

| Building | `{{details}}` |
|---|---|
| Apartment block | 5 storeys, small balconies with plants, numbered doors, shared entrance with intercom, bikes |
| Bakery | wide shopfront window full of bread, striped awning, chimney with steam, wooden bread sign |
| Farm barn | community farm plot with vegetable rows, chicken coop, hay bales, fence, water trough |
| General store | crowded shopfront with crates, barrels, a hanging "special price" sign, goods on the pavement |
| Clinic | tidy, clean façade, green cross sign, potted herbs, a bench for waiting |
| Café | terrace tables with parasols, chalkboard menu, coffee-cup sign, string lights |
| Gossip's house | colourful flowers everywhere, open window with curtains fluttering, bench right outside |
| Town hall | grand symmetric façade, clock, flagpoles with festival bunting, notice board, steps |
| Library | tall arched windows, book-shaped sign, ivy, reading bench, lamp |
| Elder's cottage | small and crooked, overgrown garden, fishing rods by the door, wind chime, smoke from chimney |

**Interior cut-away template:**
```text
Isometric cut-away interior of a cozy {{building}} in {{style}} style, two walls removed like a
dollhouse diorama, {{interior_details}}, warm lamp light, a tidy readable layout for a game.
```

---

## 4. Textures (tiling, hand-painted)

Generate at 1024², then downscale to 512² for atlases. Ask for seamless tiling.

```text
Seamless tiling hand-painted stylized texture of {{material}}, soft painterly brush strokes, pastel
{{palette_hint}}, low contrast, subtle detail suitable for low-poly game assets, flat even lighting,
top-down, no shadows, no perspective.
```

`{{material}}` per style: plaster, timber planks, clay roof tiles, slate tiles, cobblestones, terracotta tiles, whitewash stucco, sandstone plaster, zellige mosaic, kawara roof tiles, shoji paper, tatami, gravel, grass, dirt path, river pebbles, wooden deck boards.

---

## 5. Characters

**5.1 Animal turnaround** (one per animal in GDD §3.2)
```text
Character turnaround sheet (front, 3/4, side, back) of a cute humanized {{animal}} villager for a
cozy diorama game: chibi proportions about 2.5 heads tall, round soft shapes, simple dot eyes with a
small highlight, {{animal_features}}, wearing a plain {{shirt_colour}} T-shirt and {{trousers_colour}}
trousers, standing in a neutral A-pose on a plain background. Low-to-medium-poly stylized 3D look.
```

`{{animal_features}}` examples: fox → "pointed ears, bushy tail with white tip" · capybara → "small round ears, blunt muzzle, tiny orange on head" · red panda → "striped ringed tail, white face markings" · penguin → "flipper hands, round belly" · hedgehog → "soft rounded spikes on the back of the head".

**5.2 NPC character sheets**
```text
Character sheet of {{npc}} from a cozy village: a humanized {{animal}} with chibi proportions,
{{outfit}}, expression sheet with 6 faces ({{expressions}}), and one signature pose: {{pose}}.
```

| NPC | Outfit | Expressions | Pose |
|---|---|---|---|
| Baker | flour-dusted apron, headscarf, rolling pin | warm smile, worried, proud, laughing, scolding, sleepy | offering a basket of bread |
| Farmer | overalls, straw hat, rubber boots | grumpy, deadpan, secretly touched, annoyed, tired, rare smile | arms crossed holding a pitchfork |
| Shopkeeper | waistcoat, bow tie, measuring tape | sly grin, excited, mock-shocked, winking, persuasive, generous | presenting an item with a flourish |
| Doctor | white coat, stethoscope, eye bags | exhausted, stern, sceptical, relieved, sighing, kind | holding a clipboard, pinching nose bridge |
| Barista | black apron, beret, rolled sleeves | smirk, unimpressed, flustered, dreamy, ironic, pleased | pouring latte art |
| Gossip | colourful shawl, big earrings | gasp, whisper, delighted, scandalized, curious, smug | hand cupped to mouth whispering |
| Mayor | sash, top hat, ribbon badge | grandiose, outraged, teary-proud, panicking, beaming, declaring | pointing to the sky on a small podium |
| Librarian | round glasses, cardigan, book under arm | pedantic, shy, correcting, hiding a romance novel, curious, blushing | adjusting glasses with one finger |
| Elder | woolly vest, walking stick, fishing hat | mischievous, nostalgic, sleepy, wise, laughing, mysterious | sitting on the dock with a fishing rod |

---

## 6. UI and icons

**6.1 Item icon sheet**
```text
Game icon sheet, 6×6 grid, each icon a small stylized 3D-rendered {{category}} item on a transparent
background, soft pastel colours, gentle drop shadow, consistent 3/4 angle and lighting: {{items_list}}.
```
Categories: bread and pastries, drinks, fish species, foraged items (flowers, mushrooms, shells, berries), furniture, tools, lost items, ingredients.

**6.2 UI kit**
```text
Cozy game UI kit on a neutral background: rounded pastel cards with soft shadows, speech bubble
shapes with a tail, a 3-state toggle button (あ / あ+a / a), buttons (primary, secondary), a coin
counter, a heart meter (10 hearts), a clock widget with sun and moon, an inventory slot grid, a
notebook page with paper texture, a tooltip with a little arrow. Friendly rounded shapes, cream and
sage base with peach accents, hand-drawn line icons.
```

**6.3 HUD icon set** (line icons)
```text
Set of 24 hand-drawn rounded line icons for a cozy game HUD, 2 px stroke, pastel fill accents:
notebook, inventory bag, map, settings gear, coin, heart, speaker, slow turtle, translate globe,
microphone, chat bubble, emote smile, fishing rod, fork and knife, house key, quest scroll, sun,
moon, rain cloud, star, leaf difficulty marker, door, camera rotate, lightbulb hint.
```

**6.4 Difficulty sign**
```text
Small wooden village signpost for a game with 1 to 5 carved leaf symbols indicating difficulty,
5 variants side by side, painted pastel, stylized 3D, isometric.
```

---

## 7. Fish encyclopedia art

```text
Stylized cute fish illustration for a cozy game encyclopedia, side view, rounded shapes,
hand-painted texture, pastel colours, white background: {{fish_name}}, {{fish_features}}.
```
Generate one per species in `shared/src/fish.ts`.
