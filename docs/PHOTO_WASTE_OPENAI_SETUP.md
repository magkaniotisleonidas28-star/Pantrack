# Connecting photo waste to your OpenAI account

For the café owner. This connects "Record waste from a photo or note"
([decision 0010](decisions/0010-photo-waste-suggestions.md)) to the OpenAI
account you already use for AI cart preparation. Never paste the key into a
chat, an email or a document; Pantrack never needs to see it.

## 1. Create a key just for photo waste

1. Sign in at platform.openai.com with the account used for cart preparation.
2. Open **API keys** and choose **Create new secret key**.
3. Name it **Pantrack photo waste**. If you can, put it in its own project and
   give that project a monthly budget of $10, a second safety net next to
   Pantrack's own $10 cap.
4. Copy the key. OpenAI shows it only once.

A separate key can be turned off, or given its own limit, without affecting
cart preparation.

## 2. Local test on your computer (first)

1. Open the local settings file in TextEdit, from Terminal:
   `open -e ~/Desktop/Pantrack-photo-waste-20261116/.dev.vars`
2. On a new line at the end, type `OPENAI_WASTE_API_KEY=`, paste the key
   straight after the `=` with no spaces, and save. Leave the other lines as
   they are.
3. Tell Claude "the key is saved" and say how many test photos you authorize,
   for example "I authorize a paid test with up to 6 photos". Each costs
   about a fifth of a cent.

Claude then switches the local reader from the pretend one to OpenAI and runs
only the authorized test. Claude reports the suggestions, accuracy and actual
cost, and switches back afterwards. The key stays only in that file on your
computer, and the file is never saved to Git.

## 3. The live site (later, step W4f)

Adding the key to the live site and turning the feature on there happen only
when you authorize the café trial. You will be given the exact steps then.

## Turning it off

- In Pantrack: Waste → **Turn off** (owner only).
- At OpenAI: delete or disable the "Pantrack photo waste" key.
