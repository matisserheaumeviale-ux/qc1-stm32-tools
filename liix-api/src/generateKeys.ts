import crypto from "crypto";
import fs from "fs";
import path from "path";

const outputPath =
  path.join(
    process.cwd(),
    "keys.json"
  );

const names = [
  "Matisse",
  "Tester 01",
  "Tester 02",
  "Tester 03",
  "Admin"
];

const limits = [
  10_000_000,
  10_000_000,
  10_000_000,
  10_000_000,
  1_000_000_000
];

const storedKeys = [];
const rawKeys: string[] = [];

for (
  let index = 0;
  index < 5;
  index++
) {
  const number =
    String(index + 1)
      .padStart(2, "0");

  const secret =
    crypto
      .randomBytes(32)
      .toString("base64url");

  const rawKey =
    `sk-liix-${number}-${secret}`;

  const hash =
    crypto
      .createHash("sha256")
      .update(rawKey)
      .digest("hex");

  rawKeys.push(rawKey);

  storedKeys.push({
    id:
      `key_${number}`,

    name:
      names[index],

    hash,

    enabled: true,

    tokenLimit:
      limits[index],

    createdAt:
      new Date()
        .toISOString()
  });
}

fs.writeFileSync(
  outputPath,
  JSON.stringify(
    {
      keys:
        storedKeys
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log("");
console.log(
  "=============================================="
);

console.log(
  "       5 CLÉS API LIIX CRÉÉES"
);

console.log(
  "=============================================="
);

rawKeys.forEach(
  (key, index) => {
    console.log(
      `${index + 1}. ${key}`
    );
  }
);

console.log("");
console.log(
  "IMPORTANT:"
);

console.log(
  "Copie ces clés maintenant."
);

console.log(
  "keys.json contient seulement leurs SHA-256."
);

console.log(
  "Les clés originales ne pourront pas être récupérées."
);

console.log(
  "=============================================="
);

console.log("");
