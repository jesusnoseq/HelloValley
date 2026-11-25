# HelloValley — Village and NPC Design

## Overview

A cozy, Stardew Valley-inspired language-learning village with **seven buildings and nine NPCs**. Each character has a recognizable, slightly exaggerated personality, distinctive speaking habits and personal contradictions. Think cozy RPG meets sitcom.

Each building has one person in charge. Two additional villagers, the Gossip and the Elder, have no dedicated business.

## Village residents and locations

| Character | Location | Personality | Speaking style |
|---|---|---|---|
| Shopkeeper | General store | Opportunistic, charismatic, obsessed with bargains. Always trying to sell you something you don't need. Surprisingly generous when someone is struggling. | Persuasive, enthusiastic, constantly negotiating. |
| Baker | Bakery | Sweet, motherly, hardworking and slightly overprotective. Believes every problem can be solved with freshly baked bread. | Warm, affectionate, simple and reassuring. |
| Barista | Café | Artistic, sarcastic, fashionable and a little pretentious. Dreams of travelling the world but rarely leaves the village. | Casual, witty, full of slang and irony. |
| Farmer | Farm | Stubborn, humble, practical and terrible at expressing emotions. Prefers animals to people. Secretly very sentimental. | Direct, short sentences, rural expressions. |
| Mayor | Town hall | Overenthusiastic, ambitious, dramatic and obsessed with village festivals. Turns every minor inconvenience into an official matter. | Formal, exaggerated, unnecessarily elaborate. |
| Librarian | Library | Introverted, intelligent, pedantic and extremely curious. Corrects everyone's grammar. Secretly loves ridiculous romance novels. | Precise, sophisticated, educational. |
| Doctor | Clinic | Rational, responsible, strict and chronically exhausted. Constantly complains that nobody follows their advice. | Calm, analytical, instructional. |
| Gossip | Village resident | Nosy, theatrical, extremely sociable and incapable of keeping a secret. Somehow knows everything before everyone else. | Fast, expressive, full of questions and rumours. |
| Elder | Village resident | Wise, nostalgic, eccentric and mischievous. Tells long stories that may or may not be true. Enjoys confusing younger villagers. | Slow, poetic, full of proverbs and idioms. |

## Signature phrases

| Character | Typical dialogue |
|---|---|
| Shopkeeper | “For you, my friend, a very special price!” |
| Baker | “You look hungry, dear. Sit down.” |
| Barista | “You drink your coffee with sugar? Interesting choice.” |
| Farmer | “Less talking. More working.” |
| Mayor | “This is a matter of great importance to our village!” |
| Librarian | “Technically, that's not what that word means.” |
| Doctor | “Have you been sleeping properly? Don't lie to me.” |
| Gossip | “Promise you won't tell anyone, but...” |
| Elder | “Ah, that reminds me of the summer of '72...” |

## Voice and speaking tone (TTS)

Voices are generated with `gemini-3.8-flash-lite-tts` (requires the `v1beta` API). Put sustained delivery in `speech_metadata` (`speaker` + `style`) rather than in the transcript, and use inline tags (`<laugh>`, `<sigh>`, `<cough>`, `<breath>`, `<short pause>`) for brief vocal events. Prebuilt voice names and characteristics are taken from the Gemini speech-generation docs. Audition each pick and swap if it doesn't fit.

| Character | Prebuilt voice | `style` prompt | Pace / pitch | Useful tags |
|---|---|---|---|---|
| Shopkeeper | Puck (Upbeat) | Charming, upbeat salesperson. Enthusiastic and persuasive, with a conspiratorial lowered tone when announcing a "special price". | Fast-medium, bright, rising intonation | `<short pause>`, `<laugh>` |
| Baker | Sulafat (Warm) | Warm, motherly and affectionate. Soft, reassuring and unhurried, like talking to a child who needs comfort. | Slow-medium, low-mid, gentle | `<breath>`, `<laugh>` |
| Barista | Zubenelgenubi (Casual) | Casual, dry and sarcastic. Relaxed, slightly bored delivery with ironic emphasis and a hint of pretension. | Medium, flat with sudden ironic lifts | `<sigh>`, `<short pause>` |
| Farmer | Algenib (Gravelly) | Gruff, laconic and plain-spoken. Short clipped sentences, no embellishment. Awkward softness only when sentimental. | Slow, low, minimal intonation | `<cough>`, `<short pause>` |
| Mayor | Fenrir (Excitable) | Grandiose and theatrical, like a politician at a rally. Formal, over-articulated, dramatic emphasis on "important" words. | Medium-fast with dramatic slow-downs, wide pitch range | `<breath>`, `<short pause>` |
| Librarian | Sadaltager (Knowledgeable) | Precise, refined and slightly pedantic. Crisp diction, measured, with a faintly superior tone when correcting someone. | Medium, clear, controlled | `<sigh>`, `<short pause>` |
| Doctor | Schedar (Even) | Calm, tired and analytical. Even, instructional tone with weary exasperation when advice is ignored. | Medium-slow, low-mid, steady | `<sigh>`, `<breath>` |
| Gossip | Sadachbia (Lively) | Breathless, conspiratorial and theatrical. Whispered asides, gasps and rising questions. | Very fast, high, big dynamic swings | `<breath>`, `<laugh>`, `<short pause>` |
| Elder | Gacrux (Mature) | Slow, raspy storyteller with a mischievous twinkle. Poetic cadence, long pauses before punchlines, proverbs delivered like wisdom. | Slow, low, rhythmic | `<cough>`, `<laugh>`, `<short pause>` |

**Language-level adaptation:** keep the same voice and `style` at every level. Lower difficulty should slow the pace slightly and use clearer enunciation, never flatten the personality.

## Available TTS languages

`gemini-3.8-flash-lite-tts` detects the input language automatically (no language code needed). Source: [Gemini 3.8 Flash-Lite TTS model page](https://aistudio.google.com/docs/models/gemini-3.8-flash-lite-tts) and [speech generation docs](https://aistudio.google.com/docs/speech-generation). Google's own pages give differing counts (about 101 to 103), so re-check before relying on an edge case.

**Major languages (likely game targets):** English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Russian, Turkish, Japanese, Korean, Chinese (Simplified), Chinese (Traditional), Cantonese, Hindi, Standard Arabic, Egyptian Arabic, Indonesian, Vietnamese, Greek, Hebrew, Czech, Hungarian, Romanian, Danish, Norwegian Bokmål, Catalan, Basque, Galician.

**Full list:** Acehnese (Arab script), Afrikaans, Akan, Amharic, Armenian, Assamese, Awadhi, Balinese, Bangla, Banjar (Latn script), Basque, Belarusian, Bhojpuri, Bosnian, Buginese, Bulgarian, Cantonese, Catalan, Cebuano, Central Kurdish, Chhattisgarhi, Chinese (Hans), Chinese (Hant), Croatian, Czech, Danish, Dutch, Egyptian Arabic, English, Estonian, Filipino, French, Galician, Ganda, Georgian, German, Greek, Gujarati, Haitian Creole, Halh Mongolian, Hausa, Hebrew, Hindi, Hungarian, Icelandic, Iloko, Indonesian, Iranian Persian, Italian, Japanese, Javanese, Kamba, Kannada, Kashmiri (Arab script), Kashmiri (Deva script), Kazakh, Khmer, Kikuyu, Kinyarwanda, Kongo, Korean, Kyrgyz, Lao, Lingala, Macedonian, Magahi, Maithili, Malayalam, Maltese, Manipuri, Marathi, Minangkabau (Arab script), Mizo, Nepali, Nigerian Fulfulde, North Azerbaijani, Northern Sotho, Northern Uzbek, Norwegian Bokmål, Norwegian Nynorsk, Nyanja, Odia, Persian (Afghanistan), Polish, Portuguese, Punjabi, Romanian, Russian, Santali, Serbian, Sinhala, Slovak, South Azerbaijani, Southern Pashto, Spanish, Standard Arabic (Arab script), Standard Arabic (Latn script), Standard Latvian, Standard Malay, Tamil, Telugu, Turkish, Vietnamese.

**Not supported by Flash-Lite (Flash TTS only):** Banjar (Arab script), Bashkir, Bemba, Burmese, Crimean Tatar, Dyula, Dzongkha, Finnish, Guarani, Igbo, Kabyle, Latgalian, Lithuanian, Luxembourgish, Minangkabau (Latn script), Occitan, Pangasinan, Sindhi, Slovenian, Somali, Southern Sotho, Swahili, Swati, Swedish, Tajik, Thai, Tigrinya, Tosk Albanian, Uyghur.

## Relationships between characters

- **Shopkeeper and Baker:** Friendly business rivalry.
- **Barista and Librarian:** Secretly attracted to each other, but both are too proud to admit it.
- **Farmer and Mayor:** Constantly arguing about unnecessary village projects.
- **Doctor and Gossip:** Natural enemies because of patient confidentiality.
- **Gossip and Elder:** Competing sources of village information, neither entirely reliable.
- **Baker and Farmer:** Long-time friends who care for each other without saying it.
- **Librarian and Mayor:** The Librarian constantly corrects the Mayor's official announcements.

## Suggested language-learning progression

| Difficulty | Characters |
|---|---|
| Beginner | Baker, Farmer |
| Elementary | Shopkeeper, Doctor |
| Intermediate | Barista, Gossip |
| Upper intermediate | Mayor |
| Advanced | Librarian, Elder |

Every character should remain accessible at every language level, adapting their vocabulary and sentence complexity while preserving their personality. A beginner should be able to enjoy the Gossip's rumours just as much as an advanced learner.

The character's personality becomes part of the language-learning experience, rather than making the game feel like a collection of exercises disguised as an RPG.
