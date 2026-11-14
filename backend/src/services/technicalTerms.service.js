/**
 * Technical vocabulary protection for dubbing.
 *
 * The transcription and the translation model both mangle technical names:
 * "terminal" becomes "erminal", "Guest Additions" becomes "gues edition" and
 * the spoken Arabic form becomes "غيسْت" instead of "جيست". A dub that
 * mispronounces a command, a product name or a menu item is unusable for a
 * technical course, so the terms are repaired deterministically after the
 * model has run instead of trusting the model to copy them correctly.
 *
 * The module is intentionally free of model calls: it can be used to repair
 * already stored translations as well as fresh ones.
 */

const AR_TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const LATIN_TOKEN = /[A-Za-z][A-Za-z0-9.+#_/\\-]*/g;
const ARABIC_TOKEN = /[\u0621-\u065F\u066E-\u06D3]+/g;

const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Canonical technical terms with the way they are spoken in Arabic.
 *
 * `aliases` contains the misspellings produced by the speech-to-text model and
 * by the translation model. `arabicAliases` contains the Arabic words the
 * models use when they translate the term instead of keeping it.
 */
const GLOSSARY = [
  {
    canonical: "Guest Additions",
    aliases: [
      "guest additions",
      "guest addition",
      "guest editions",
      "guest edition",
      "gues additions",
      "gues addition",
      "gues editions",
      "gues edition",
      "guess additions",
      "guess edition",
      "guest aditions",
      "guest addisions",
    ],
    spoken: { ar: "جِيست أَدِيشِنز" },
    arabicAliases: ["إضافات الضيف", "إضافات الجيست", "إضافات جيست"],
  },
  {
    canonical: "CD image",
    aliases: [
      "cd image",
      "cd-image",
      "cdimage",
      "cd rom image",
      "cd-rom image",
    ],
    spoken: { ar: "سِي دِي إِيمِيج" },
    arabicAliases: ["صورة القرص", "صورة قرص", "صورة السي دي", "صورة سي دي"],
  },
  {
    // The installer script of the Guest Additions ISO. The transcription writes
    // it as "linuxadditions.run" or "linux additions.run"; the Arabic voice has
    // to read the whole name, not a merged blob.
    canonical: "linuxadditions.run",
    aliases: ["linuxadditions.run", "linuxadditions"],
    spoken: { ar: "لِينُكْس أَدِيشِنْز دُوت رَان" },
    arabicAliases: [],
  },
  {
    canonical: "additions.run",
    aliases: ["additions.run", "additions run"],
    spoken: { ar: "أَدِيشِنْز دُوت رَان" },
    arabicAliases: [],
  },
  {
    canonical: "VirtualBox",
    aliases: [
      "virtualbox",
      "virtual box",
      "virtual-box",
      "فيرتشوال بوكس",
      "فيرتوال بوكس",
    ],
    spoken: { ar: "فِيرْتُشُوَال بُوكْس" },
    arabicAliases: ["فيرتشوال بوكس", "فيرتوال بوكس"],
  },
  {
    canonical: "Bridged Adapter",
    aliases: [
      "bridged adapter",
      "bridged adapters",
      "bridge adapter",
      "bridging adapter",
    ],
    spoken: { ar: "بريدج أدابتر" },
    arabicAliases: [],
  },
  {
    canonical: "Kali Linux",
    aliases: ["kali linux", "kali-linux"],
    spoken: { ar: "كَالِي لِينُكْس" },
    arabicAliases: ["كالي لينكس", "كالي لينوكس"],
  },
  {
    canonical: "Kali",
    aliases: ["kali"],
    spoken: { ar: "كَالِي" },
    arabicAliases: ["كالي"],
  },
  {
    canonical: "Linux",
    aliases: ["linux"],
    spoken: { ar: "لِينُكْس" },
    arabicAliases: ["لينكس", "لينوكس"],
  },
  {
    canonical: "terminal",
    aliases: ["terminal", "terminals", "the terminal"],
    spoken: { ar: "تِيرْمِينَال" },
    arabicAliases: [
      "الطرفية",
      "الطرفيه",
      "طرفية",
      "طرفيه",
      "طرفيتنا",
      "طرفيتك",
      "طرفيته",
      "طرفيتها",
      "نافذة الطرفية",
      "المحطة الطرفية",
      "تيرمينال",
      "ترمينال",
      "ترمنال",
    ],
  },
  {
    canonical: "sudo",
    aliases: ["sudo"],
    spoken: { ar: "سُودُو" },
    arabicAliases: ["سودو"],
  },
  {
    canonical: "ISO",
    aliases: ["iso", "iso image", "iso file"],
    spoken: { ar: "إِيزُو" },
    arabicAliases: ["إيزو", "ايزو"],
  },
  {
    canonical: "Ubuntu",
    aliases: ["ubuntu"],
    spoken: { ar: "أُوبُونْتُو" },
    arabicAliases: ["أوبونتو", "اوبونتو"],
  },
  {
    canonical: "Debian",
    aliases: ["debian"],
    spoken: { ar: "دِيبِيَان" },
    arabicAliases: ["ديبيان"],
  },
  {
    canonical: "Windows",
    aliases: ["windows"],
    spoken: { ar: "وِينْدُوز" },
    arabicAliases: ["ويندوز"],
  },
  {
    canonical: "GitHub",
    aliases: ["github", "git hub"],
    spoken: { ar: "جِيت هَاب" },
    arabicAliases: ["جيت هاب", "جيتهاب"],
  },
  {
    canonical: "Git",
    aliases: ["git"],
    spoken: { ar: "جِيت" },
    arabicAliases: ["جيت"],
  },
  {
    canonical: "Node.js",
    aliases: ["node.js", "nodejs", "node js"],
    spoken: { ar: "نُود جِي إِس" },
    arabicAliases: ["نود جي إس", "نود جي اس"],
  },
  {
    canonical: "JavaScript",
    aliases: ["javascript", "java script"],
    spoken: { ar: "جَافَاسْكْرِيبْت" },
    arabicAliases: ["جافاسكريبت", "جافا سكريبت"],
  },
  {
    canonical: "Python",
    aliases: ["python"],
    spoken: { ar: "بَايثُون" },
    arabicAliases: ["بايثون"],
  },
  {
    canonical: "Docker",
    aliases: ["docker"],
    spoken: { ar: "دُوكَر" },
    arabicAliases: ["دوكر"],
  },
  {
    canonical: "MongoDB",
    aliases: ["mongodb", "mongo db", "mongo"],
    spoken: { ar: "مُونْجُو دِي بِي" },
    arabicAliases: ["مونجو دي بي", "مونجو"],
  },
  {
    canonical: "MySQL",
    aliases: ["mysql", "my sql"],
    spoken: { ar: "مَاي إِس كْيُو إِل" },
    arabicAliases: ["ماي إس كيو إل"],
  },
  {
    canonical: "API",
    aliases: ["api", "apis"],
    spoken: { ar: "إِيه بِي آي" },
    arabicAliases: ["إيه بي آي", "اي بي اي"],
  },
  {
    canonical: "URL",
    aliases: ["url", "urls"],
    spoken: { ar: "يُو آر إِل" },
    arabicAliases: ["يو آر إل"],
  },
  {
    canonical: "HTML",
    aliases: ["html"],
    spoken: { ar: "إِتش تِي إِم إِل" },
    arabicAliases: ["إتش تي إم إل"],
  },
  {
    canonical: "CSS",
    aliases: ["css"],
    spoken: { ar: "سِي إِس إِس" },
    arabicAliases: ["سي إس إس"],
  },
  {
    canonical: "JSON",
    aliases: ["json"],
    spoken: { ar: "جِيسُون" },
    arabicAliases: ["جيسون"],
  },
  {
    canonical: "SSH",
    aliases: ["ssh"],
    spoken: { ar: "إِس إِس إِتش" },
    arabicAliases: ["إس إس إتش"],
  },
  {
    canonical: "FTP",
    aliases: ["ftp"],
    spoken: { ar: "إِف تِي بِي" },
    arabicAliases: ["إف تي بي"],
  },
  {
    canonical: "CPU",
    aliases: ["cpu"],
    spoken: { ar: "سِي بِي يُو" },
    arabicAliases: ["سي بي يو"],
  },
  {
    canonical: "RAM",
    aliases: ["ram"],
    spoken: { ar: "رَام" },
    arabicAliases: ["رام"],
  },
  {
    canonical: "USB",
    aliases: ["usb"],
    spoken: { ar: "يُو إِس بِي" },
    arabicAliases: ["يو إس بي"],
  },
  {
    canonical: "BIOS",
    aliases: ["bios"],
    spoken: { ar: "بَايُوس" },
    arabicAliases: ["بايوس"],
  },
  {
    canonical: "kernel",
    aliases: ["kernel"],
    spoken: { ar: "كِيرْنِل" },
    arabicAliases: ["كيرنل", "النواة"],
  },
  {
    canonical: "root",
    aliases: ["root user", "root"],
    spoken: { ar: "رُوت" },
    arabicAliases: ["روت", "المستخدم الجذر"],
  },
  {
    canonical: "bash",
    aliases: ["bash"],
    spoken: { ar: "بَاش" },
    arabicAliases: ["باش"],
  },
  {
    canonical: "shell",
    aliases: ["shell"],
    spoken: { ar: "شِل" },
    arabicAliases: ["شل"],
  },
  {
    canonical: "apt",
    aliases: ["apt-get", "apt get", "apt"],
    spoken: { ar: "أَبْت" },
    arabicAliases: ["أبت", "ابت"],
  },
  {
    canonical: "dpkg",
    aliases: ["dpkg"],
    spoken: { ar: "دِي بِي كِي جِي" },
    arabicAliases: ["دي بي كي جي"],
  },
  {
    canonical: "GRUB",
    aliases: ["grub"],
    spoken: { ar: "جْرُوب" },
    arabicAliases: ["جروب", "غروب"],
  },
  {
    canonical: "VPN",
    aliases: ["vpn"],
    spoken: { ar: "فِي بِي إِن" },
    arabicAliases: ["في بي إن", "في بي ان"],
  },
  {
    canonical: "NAT",
    aliases: ["nat", "nating", "natting"],
    spoken: { ar: "نات" },
    arabicAliases: [],
  },
  {
    canonical: "NAT network",
    aliases: ["nat network", "nat networks", "NAT Network"],
    spoken: { ar: "شبكة نات" },
    arabicAliases: [],
  },
  {
    canonical: "IPv4",
    aliases: ["ipv4", "ipv 4"],
    spoken: { ar: "آي بي في 4" },
    arabicAliases: ["آي بي في 4", "يبف4"],
  },
  {
    canonical: "IPv6",
    aliases: ["ipv6", "ipv 6"],
    spoken: { ar: "آي بي في 6" },
    arabicAliases: ["آي بي في 6", "يبف6"],
  },
  {
    canonical: "eth0",
    aliases: ["eth0", "eth 0", "ethernet0"],
    spoken: { ar: "إث صفر" },
    arabicAliases: ["يث0", "اث صفر"],
  },
  {
    canonical: "eth1",
    aliases: ["eth1", "eth 1", "ethernet1"],
    spoken: { ar: "إث واحد" },
    arabicAliases: ["يث1", "اث واحد"],
  },
  {
    canonical: "Tor",
    aliases: ["tor network", "tor"],
    spoken: { ar: "تُور" },
    arabicAliases: ["تور"],
  },
  {
    canonical: "Anonsurf",
    aliases: ["anonsurf", "anon surf"],
    spoken: { ar: "أَنُون سِيرْف" },
    arabicAliases: ["أنون سيرف", "انون سيرف"],
  },
  {
    canonical: "Firefox",
    aliases: ["firefox"],
    spoken: { ar: "فَايَرْفُوكْس" },
    arabicAliases: ["فايرفوكس"],
  },
  {
    canonical: "Chrome",
    aliases: ["google chrome", "chrome"],
    spoken: { ar: "كْرُوم" },
    arabicAliases: ["كروم"],
  },
  {
    canonical: "virtual machine",
    aliases: ["virtual machine", "virtual machines", "vm", "vms"],
    spoken: { ar: "فِيرْتُوَال مَشِين" },
    arabicAliases: ["الجهاز الافتراضي", "الآلة الافتراضية", "جهاز افتراضي"],
  },
  {
    canonical: "snapshot",
    aliases: ["snapshot", "snapshots"],
    spoken: { ar: "سْنَابْشُوت" },
    arabicAliases: ["سنابشوت", "لقطة"],
  },
  {
    canonical: "nmap",
    aliases: ["nmap"],
    spoken: { ar: "إِن مَاب" },
    arabicAliases: ["إن ماب", "ان ماب"],
  },
  {
    canonical: "Wireshark",
    aliases: ["wireshark"],
    spoken: { ar: "وَايَرْشَارْك" },
    arabicAliases: ["وايرشارك"],
  },
  {
    canonical: "Metasploit",
    aliases: ["metasploit"],
    spoken: { ar: "مِيتَاسْبْلُوِيت" },
    arabicAliases: ["ميتاسبلويت"],
  },
  {
    canonical: "Burp Suite",
    aliases: ["burp suite", "burpsuite", "burp"],
    spoken: { ar: "بِيرْب سْوِيت" },
    arabicAliases: ["بيرب سويت"],
  },
  {
    canonical: "sqlmap",
    aliases: ["sqlmap", "sql map"],
    spoken: { ar: "إِس كْيُو إِل مَاب" },
    arabicAliases: ["إس كيو إل ماب"],
  },
  {
    canonical: "Hashcat",
    aliases: ["hashcat", "hash cat"],
    spoken: { ar: "هَاشْكَات" },
    arabicAliases: ["هاشكات"],
  },
  {
    canonical: "//media//cdrom0",
    aliases: ["//media//cdrom0", "/media/cdrom0", "media/cdrom0"],
    spoken: { ar: "مِيدْيَا سِي دِي رُوم صِفْر" },
    arabicAliases: ["ميديا سي دي روم صفر"],
  },
  {
    canonical: "Settings",
    aliases: ["settings", "setting", "setings", "se ings", "se-tings"],
    spoken: { ar: "سِيتِينْغْز" },
    arabicAliases: [],
  },
  {
    canonical: "OK",
    aliases: ["ok", "okay", "o k"],
    spoken: { ar: "أُوكَيْ" },
    arabicAliases: [],
  },
  {
    canonical: "IP",
    aliases: ["ip"],
    spoken: { ar: "آي بِي" },
    arabicAliases: ["أبي إي", "أي بي", "آبي إي", "أيبي"],
  },
  {
    canonical: "DHCP",
    aliases: ["dhcp"],
    spoken: { ar: "دِي إِتْش سِي بِي" },
    arabicAliases: [],
  },
  {
    canonical: "ifconfig",
    aliases: ["ifconfig", "if config", "ipconfig"],
    spoken: { ar: "إِف كُونْفِيج" },
    arabicAliases: ["يفكونفيج", "إفكونفيج", "يف كونفيج", "إف كونفيج"],
  },
  {
    canonical: "ping",
    aliases: ["ping"],
    spoken: { ar: "بِينْغ" },
    arabicAliases: [],
  },
  {
    canonical: "google.com",
    aliases: ["google.com", "google com"],
    spoken: { ar: "جُوجِل دُوت كُوم" },
    arabicAliases: [],
  },
  {
    canonical: "Mac",
    aliases: ["mac", "macos", "mac os"],
    spoken: { ar: "مَاك" },
    arabicAliases: ["ماك"],
  },
  {
    canonical: "exe",
    aliases: ["exe", "exe files"],
    spoken: { ar: "إِيكْس إِي" },
    arabicAliases: [],
  },
];

// Latin words that are technical even when they are not written in an
// obvious technical shape (all caps, digits, CamelCase).
const EXTRA_TECH_WORDS = new Set([
  "sudo",
  "apt",
  "dpkg",
  "bash",
  "zsh",
  "shell",
  "kernel",
  "root",
  "chmod",
  "chown",
  "ssh",
  "scp",
  "curl",
  "wget",
  "nmap",
  "wireshark",
  "metasploit",
  "hydra",
  "sqlmap",
  "aircrack",
  "hashcat",
  "git",
  "github",
  "docker",
  "node",
  "nodejs",
  "python",
  "java",
  "virtualbox",
  "vmware",
  "kali",
  "linux",
  "ubuntu",
  "debian",
  "windows",
  "macos",
  "firefox",
  "chrome",
  "tor",
  "vpn",
  "iso",
  "usb",
  "cpu",
  "ram",
  "bios",
  "api",
  "url",
  "html",
  "css",
  "json",
  "sql",
  "mysql",
  "mongodb",
  "npm",
  "npx",
  "tar",
  "gzip",
  "powershell",
  "terminal",
  "snapshot",
  "grub",
  "dpkg",
  "anonsurf",
]);

// ---------------------------------------------------------------------------
// Small string helpers
// ---------------------------------------------------------------------------

const languageBase = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/[-_]/)[0];

const NON_LATIN_TARGETS = new Set([
  "ar",
  "fa",
  "ur",
  "ps",
  "he",
  "ru",
  "uk",
  "bg",
  "hi",
  "mr",
  "bn",
  "th",
  "zh",
  "ja",
  "ko",
  "el",
]);

const usesLatinScript = (targetLanguage) =>
  !NON_LATIN_TARGETS.has(languageBase(targetLanguage));

const normalizeLatin = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeArabic = (value) =>
  String(value || "")
    .replace(AR_TASHKEEL, "")
    .replace(/\u0640/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0621-\u064A\u0660-\u0669\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
};

const similarity = (a, b) => {
  const left = normalizeLatin(a);
  const right = normalizeLatin(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length);
};

const arabicSimilarity = (a, b) => {
  const left = normalizeArabic(a);
  const right = normalizeArabic(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length);
};

/**
 * Builds a regular expression for a term. Spaces may be written as spaces,
 * hyphens or underscores because the models alternate between "Guest
 * Additions", "guest-additions" and "guest_additions".
 */
const termRegex = (term, flags = "gi") => {
  const value = String(term || "").trim();
  const parts = value.split(/\s+/).map(escapeRegExp);
  const startBoundary = /^[A-Za-z0-9]/.test(value) ? "(?<![A-Za-z0-9])" : "";
  const endBoundary = /[A-Za-z0-9]$/.test(value) ? "(?![A-Za-z0-9])" : "";
  return new RegExp(
    `${startBoundary}${parts.join("[\\s\\-_]+")}${endBoundary}`,
    flags,
  );
};

const latinTokens = (text) => {
  const tokens = [];
  const regex = new RegExp(LATIN_TOKEN.source, "g");
  let match;
  while ((match = regex.exec(text))) {
    // "erminal." must keep its sentence period outside the token, otherwise
    // repairing the term would delete the punctuation.
    const value = match[0].replace(/[.,;:!?]+$/, "");
    if (!value) continue;
    tokens.push({ value, start: match.index, end: match.index + value.length });
  }
  return tokens;
};

const arabicTokens = (text) => {
  const tokens = [];
  const regex = new RegExp(ARABIC_TOKEN.source, "g");
  let match;
  while ((match = regex.exec(text))) {
    tokens.push({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
};

const onlySeparators = (text, tokens) => {
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const between = text.slice(tokens[i].end, tokens[i + 1].start);
    if (!/^[\s,;:()\-–—/.]*$/.test(between)) return false;
  }
  return true;
};

/**
 * Finds the closest Latin phrase to `term` inside `text`. This is what turns
 * "erminal" back into "terminal" and "gues edition" back into "Guest
 * Additions".
 */
const findBestLatinWindow = (
  text,
  term,
  threshold = 0.66,
  { skipExact = false, exactSize = false } = {},
) => {
  const tokens = latinTokens(text);
  if (!tokens.length) return null;

  const words =
    String(term || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length || 1;
  const normalizedTerm = normalizeLatin(term);
  let best = null;

  const sizes = exactSize ? [words] : words > 1 ? [words, words - 1] : [1];
  for (const size of sizes) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      const window = tokens.slice(index, index + size);
      if (!onlySeparators(text, window)) continue;

      const phrase = text.slice(window[0].start, window[window.length - 1].end);
      const normalizedPhrase = normalizeLatin(phrase);
      if (skipExact && normalizedPhrase === normalizedTerm) continue;

      let score;
      if (size === words) {
        // A phrase that is much longer or shorter than the term is a different
        // term, not a misspelling of this one ("linux additions run" is not a
        // broken "additions.run").
        if (Math.abs(normalizedPhrase.length - normalizedTerm.length) > 4)
          continue;
        score = similarity(phrase, term);
        if (score < threshold) continue;
      } else {
        // A shorter phrase is accepted only when it is the beginning of the
        // term ("CD" for "CD image", "guest" for "Guest Additions").
        if (normalizedPhrase.length < 2) continue;
        if (!normalizedTerm.startsWith(normalizedPhrase)) continue;
        // If the following words already complete the term, the full-size
        // window handles it and the prefix must not be expanded on its own.
        const following = tokens.slice(index + size, index + words);
        const extendedEnd =
          following.length > 0
            ? following[following.length - 1].end
            : window[window.length - 1].end;
        const extended = normalizeLatin(
          text.slice(window[0].start, extendedEnd),
        );
        if (extended.startsWith(normalizedTerm)) continue;
        score = 0.7;
      }

      if (!best || score > best.score + 0.0001) {
        best = {
          start: window[0].start,
          end: window[window.length - 1].end,
          score,
        };
      }
    }
  }

  return best;
};

/**
 * Same idea for Arabic: finds the way the model transliterated a term and
 * replaces it with the canonical pronunciation.
 */
const findBestArabicWindow = (
  text,
  term,
  threshold = 0.6,
  { skipExact = false } = {},
) => {
  const tokens = arabicTokens(text);
  if (!tokens.length) return null;

  const words =
    String(term || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length || 1;
  const normalizedTerm = normalizeArabic(term);
  let best = null;

  const sizes = words > 1 ? [words, words - 1] : [1];
  for (const size of sizes) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      const window = tokens.slice(index, index + size);
      if (!onlySeparators(text, window)) continue;

      const phrase = text.slice(window[0].start, window[window.length - 1].end);
      const normalizedPhrase = normalizeArabic(phrase);
      if (skipExact && normalizedPhrase === normalizedTerm) continue;

      let score;
      if (size === words) {
        score = arabicSimilarity(phrase, term);
        if (score < threshold) continue;
      } else {
        // A shorter phrase is accepted only when it is the beginning of the
        // term ("سي دي" for "سي دي إيميج").
        if (normalizedPhrase.length < 3) continue;
        if (!normalizedTerm.startsWith(normalizedPhrase)) continue;
        // If the following words already complete the term, the full-size
        // window handles it and the prefix must not be expanded on its own.
        const following = tokens.slice(index + size, index + words);
        const extendedEnd =
          following.length > 0
            ? following[following.length - 1].end
            : window[window.length - 1].end;
        const extended = normalizeArabic(
          text.slice(window[0].start, extendedEnd),
        );
        if (extended.startsWith(normalizedTerm)) continue;
        score = 0.7;
      }

      if (!best || score > best.score + 0.0001) {
        best = {
          start: window[0].start,
          end: window[window.length - 1].end,
          score,
        };
      }
    }
  }

  return best;
};

const replaceSpan = (text, span, replacement) =>
  text.slice(0, span.start) + replacement + text.slice(span.end);

const hasCanonical = (text, term) =>
  termRegex(term, "i").test(String(text || ""));

const normalizeCanonical = (text, term) =>
  String(text || "").replace(termRegex(term, "gi"), term);

// ---------------------------------------------------------------------------
// Latin -> Arabic fallback transliteration
// ---------------------------------------------------------------------------

const TRANSLIT_RULES = [
  ["tch", "تش"],
  ["sch", "ش"],
  ["sh", "ش"],
  ["ch", "تش"],
  ["th", "ث"],
  ["ph", "ف"],
  ["kh", "خ"],
  ["gh", "غ"],
  ["ck", "ك"],
  ["qu", "كو"],
  ["oo", "و"],
  ["ee", "ي"],
  ["ea", "ي"],
  ["ou", "او"],
  ["ai", "اي"],
  ["ay", "اي"],
  ["ey", "اي"],
  ["oa", "و"],
  ["ie", "ي"],
];

const TRANSLIT_LETTERS = {
  a: "ا",
  b: "ب",
  c: "ك",
  d: "د",
  e: "ي",
  f: "ف",
  g: "ج",
  h: "ه",
  i: "ي",
  j: "ج",
  k: "ك",
  l: "ل",
  m: "م",
  n: "ن",
  o: "و",
  p: "ب",
  q: "ك",
  r: "ر",
  s: "س",
  t: "ت",
  u: "و",
  v: "ف",
  w: "و",
  x: "كس",
  y: "ي",
  z: "ز",
};

/**
 * Deterministic fallback so an unknown technical name is at least readable in
 * Arabic instead of being left in Latin script (which the Arabic voice reads
 * as English and mispronounces).
 */
export const transliterateToArabic = (value) => {
  const source = String(value || "").trim();
  if (!source) return "";
  if (/[\u0600-\u06FF]/.test(source)) return source;

  const lower = source.toLowerCase();
  let out = "";

  for (let index = 0; index < lower.length; ) {
    const char = lower[index];

    if (char === ".") {
      out += " دوت ";
      index += 1;
      continue;
    }
    if (char === "/") {
      out += " سلاش ";
      index += 1;
      continue;
    }
    if (char === "-") {
      out += " ";
      index += 1;
      continue;
    }
    if (char === "_") {
      out += " أندر سكور ";
      index += 1;
      continue;
    }
    if (char === "+") {
      out += " بلس ";
      index += 1;
      continue;
    }
    if (char === "#") {
      out += " هاش ";
      index += 1;
      continue;
    }
    if (!/[a-z]/.test(char)) {
      out += char;
      index += 1;
      continue;
    }

    const rule = TRANSLIT_RULES.find(([latin]) =>
      lower.startsWith(latin, index),
    );
    if (rule) {
      out += rule[1];
      index += rule[0].length;
      continue;
    }

    out += TRANSLIT_LETTERS[char] || "";
    index += 1;
  }

  return out.replace(/\s+/g, " ").trim();
};

// ---------------------------------------------------------------------------
// Term discovery
// ---------------------------------------------------------------------------

const isGenericTechnicalToken = (token) => {
  const value = String(token || "");
  if (value.length < 2) return false;
  if (/^\d+$/.test(value)) return false;
  if (EXTRA_TECH_WORDS.has(value.toLowerCase())) return true;
  if (/^[A-Z0-9]{2,}$/.test(value)) return true;
  if (/\d/.test(value) && /[A-Za-z]/.test(value)) return true;
  if (/[A-Za-z]\.[A-Za-z]/.test(value)) return true;
  if (/[+#]/.test(value)) return true;
  if (/[a-z][A-Z]/.test(value)) return true;
  return false;
};

const glossaryEntriesIn = (text) => {
  const source = String(text || "");
  const found = [];
  const spans = [];

  for (const entry of GLOSSARY) {
    const aliases = [entry.canonical, ...(entry.aliases || [])];
    let matched = false;
    for (const alias of aliases) {
      const regex = termRegex(alias, "gi");
      let match;
      while ((match = regex.exec(source))) {
        matched = true;
        spans.push([match.index, match.index + match[0].length]);
        if (match[0].length === 0) regex.lastIndex += 1;
      }
    }
    if (matched) found.push(entry);
  }

  return { found, spans };
};

const overlaps = (start, end, spans) =>
  spans.some(([spanStart, spanEnd]) => start < spanEnd && end > spanStart);

/**
 * Returns the canonical technical terms contained in the source sentence.
 */
export const findTermsInSource = (sourceText) => {
  const source = String(sourceText || "");
  const { found, spans } = glossaryEntriesIn(source);
  const byCanonical = new Map();

  for (const entry of found) {
    byCanonical.set(entry.canonical.toLowerCase(), entry);
  }

  // Unknown product names / acronyms / commands that still must be preserved.
  for (const token of latinTokens(source)) {
    if (overlaps(token.start, token.end, spans)) continue;
    if (!isGenericTechnicalToken(token.value)) continue;
    const key = token.value.toLowerCase();
    if (byCanonical.has(key)) continue;
    byCanonical.set(key, {
      canonical: token.value,
      aliases: [token.value],
      spoken: { ar: transliterateToArabic(token.value) },
      arabicAliases: [],
      generic: true,
    });
  }

  return Array.from(byCanonical.values());
};

/**
 * Fixes known speech-to-text mistakes in the source sentence before it is
 * translated, so the translation is based on the real technical term
 * ("guest edition CD image" -> "Guest Additions CD image").
 */
export const normalizeTechnicalSource = (text) => {
  let out = String(text || "");
  if (!out) return out;

  for (const entry of GLOSSARY) {
    for (const alias of entry.aliases || []) {
      if (alias.toLowerCase() === entry.canonical.toLowerCase()) continue;
      if (!/^[A-Za-z0-9 .+#/_-]+$/.test(alias)) continue;
      const regex = termRegex(alias, "gi");
      if (regex.test(out)) {
        out = out.replace(termRegex(alias, "gi"), entry.canonical);
      }
    }
  }

  return out;
};

const getSpokenForm = (term, targetLanguage) => {
  if (!term) return "";
  if (usesLatinScript(targetLanguage)) return term.canonical;
  const target = languageBase(targetLanguage);
  return term.spoken?.[target] || transliterateToArabic(term.canonical);
};

const sortByLength = (terms) =>
  [...terms].sort(
    (a, b) => String(b.canonical).length - String(a.canonical).length,
  );

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

const MAX_TERM_REPAIRS = 5;

// Short terms ("root", "bash", "ISO") are too easy to confuse with a normal
// word, so they must match exactly. Longer terms tolerate one or two wrong
// letters, which is how "erminal" and "gues edition" are recovered.
const minLatinScore = (term, base) =>
  normalizeLatin(term).replace(/\s+/g, "").length <= 4 ? 0.99 : base;

const minArabicScore = (term, base) =>
  normalizeArabic(term).replace(/\s+/g, "").length <= 4 ? 0.99 : base;

/**
 * Keeps the Arabic conjunction/article that the model attached to the term
 * ("وَالتِّرْمِينَالْ" -> "وَالتِّيرْمِينَال"), so repairing the term never
 * breaks the grammar of the sentence.
 */
const preserveArabicPrefix = (matchedText, replacement) => {
  const bare = normalizeArabic(matchedText);
  const repl = normalizeArabic(replacement);
  if (!bare || !repl || bare === repl) return replacement;

  for (const prefix of ["وال", "فال", "بال", "كال", "لل", "ال"]) {
    const normalizedPrefix = normalizeArabic(prefix);
    if (!bare.startsWith(normalizedPrefix)) continue;
    const rest = bare.slice(normalizedPrefix.length);
    if (!rest) continue;
    if (arabicSimilarity(rest, repl) < 0.8) continue;

    // Keep the original characters of the prefix, including its diacritics,
    // so "وَالتِّرْمِينَالْ" becomes "وَالتِّيرْمِينَال" and not "والتِيرْمِينَال".
    let consumed = 0;
    let cut = 0;
    for (let index = 0; index < matchedText.length; index += 1) {
      const char = matchedText[index];
      if (/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/.test(char))
        continue;
      consumed += 1;
      cut = index + 1;
      if (consumed === normalizedPrefix.length) break;
    }
    const originalPrefix = matchedText.slice(0, cut);
    return originalPrefix ? originalPrefix + replacement : replacement;
  }

  return replacement;
};

const repairTextWithTerms = (text, terms) => {
  let out = String(text || "");
  if (!out) return out;

  for (const term of sortByLength(terms)) {
    // "additions.run" is a part of "linuxadditions.run" and "Linux" is a part
    // of "Kali Linux": when the longer term is already correct in the text,
    // the shorter one must not match inside it.
    const lowerCanonical = term.canonical.toLowerCase();
    const insideLonger = terms.some(
      (other) =>
        other !== term &&
        other.canonical.length > term.canonical.length &&
        other.canonical.toLowerCase().includes(lowerCanonical) &&
        hasCanonical(out, other.canonical),
    );
    if (insideLonger) continue;

    // Mangled Latin forms: "erminal", "gues edition", "Gues Additions".
    for (let guard = 0; guard < MAX_TERM_REPAIRS; guard += 1) {
      const latinHit = findBestLatinWindow(
        out,
        term.canonical,
        minLatinScore(term.canonical, 0.66),
        {
          skipExact: true,
        },
      );
      if (!latinHit) break;
      out = replaceSpan(out, latinHit, term.canonical);
    }

    // Mangled variants of the term that are already known ("se ings").
    // Only an exact token count is accepted here: a two-word alias must not
    // swallow a neighbouring word.
    for (const alias of term.aliases || []) {
      if (alias.toLowerCase() === term.canonical.toLowerCase()) continue;
      if (!/^[A-Za-z0-9 .+#/_-]+$/.test(alias)) continue;
      for (let guard = 0; guard < MAX_TERM_REPAIRS; guard += 1) {
        const hit = findBestLatinWindow(out, alias, 0.8, {
          exactSize: true,
        });
        if (!hit) break;
        const phrase = out.slice(hit.start, hit.end);
        if (normalizeLatin(phrase) === normalizeLatin(term.canonical)) break;
        // "image" must never be read as a broken "cdimage": the first letter
        // has to match the alias.
        if (phrase[0]?.toLowerCase() !== alias[0]?.toLowerCase()) break;
        out = replaceSpan(out, hit, term.canonical);
      }
    }

    // Normalise the casing of a term that is already spelled correctly.
    if (hasCanonical(out, term.canonical)) {
      out = normalizeCanonical(out, term.canonical);
      continue;
    }

    // The model translated the term instead of keeping it. Known Arabic
    // equivalents are restored to the canonical Latin term.
    for (const alias of term.arabicAliases || []) {
      const arabicHit = findBestArabicWindow(out, alias, 0.8);
      if (arabicHit) {
        out = replaceSpan(out, arabicHit, term.canonical);
        break;
      }
    }
  }

  return out;
};

const repairSpokenWithTerms = (spoken, terms, targetLanguage) => {
  let out = String(spoken || "");
  if (!out) return out;

  const latinTarget = usesLatinScript(targetLanguage);

  for (const term of sortByLength(terms)) {
    const spokenForm = getSpokenForm(term, targetLanguage);
    if (!spokenForm) continue;

    if (latinTarget) {
      for (let guard = 0; guard < MAX_TERM_REPAIRS; guard += 1) {
        const hit = findBestLatinWindow(
          out,
          term.canonical,
          minLatinScore(term.canonical, 0.66),
          {
            skipExact: true,
          },
        );
        if (!hit) break;
        out = replaceSpan(out, hit, spokenForm);
      }
      continue;
    }

    let replaced = false;

    // 1. An existing Arabic transliteration, possibly misspelled.
    for (let guard = 0; guard < MAX_TERM_REPAIRS; guard += 1) {
      const hit = findBestArabicWindow(
        out,
        spokenForm,
        minArabicScore(spokenForm, 0.6),
        {
          skipExact: true,
        },
      );
      if (!hit) break;
      const matched = out.slice(hit.start, hit.end);
      out = replaceSpan(out, hit, preserveArabicPrefix(matched, spokenForm));
      replaced = true;
      // One repair pass per occurrence: the replacement can itself contain the
      // searched form, so searching again would replace the same spot forever.
      break;
    }

    // 2. The term was left in Latin script.
    if (!replaced) {
      for (let guard = 0; guard < MAX_TERM_REPAIRS; guard += 1) {
        const hit = findBestLatinWindow(
          out,
          term.canonical,
          minLatinScore(term.canonical, 0.66),
          {
            skipExact: true,
          },
        );
        if (!hit) break;
        out = replaceSpan(out, hit, spokenForm);
        replaced = true;
        break;
      }
    }

    // 3. A known Arabic paraphrase ("الطرفية" for terminal).
    if (!replaced) {
      for (const alias of term.arabicAliases || []) {
        for (let guard = 0; guard < MAX_TERM_REPAIRS; guard += 1) {
          const hit = findBestArabicWindow(out, alias, 0.8);
          if (!hit) break;
          const matched = out.slice(hit.start, hit.end);
          out = replaceSpan(
            out,
            hit,
            preserveArabicPrefix(matched, spokenForm),
          );
          replaced = true;
          break;
        }
        if (replaced) break;
      }
    }
  }

  return out;
};

const spokenMentionsTerm = (spoken, term, targetLanguage) => {
  const spokenForm = getSpokenForm(term, targetLanguage);
  if (!spokenForm) return true;
  if (usesLatinScript(targetLanguage)) {
    return (
      hasCanonical(spoken, spokenForm) ||
      Boolean(findBestLatinWindow(spoken, term.canonical))
    );
  }
  return (
    Boolean(findBestArabicWindow(spoken, spokenForm)) ||
    Boolean(findBestLatinWindow(spoken, term.canonical))
  );
};

const dedupeTerms = (terms) => {
  const map = new Map();
  for (const term of terms || []) {
    const key = String(term?.canonical || "").toLowerCase();
    if (key && !map.has(key)) map.set(key, term);
  }
  return Array.from(map.values());
};

/**
 * Replaces every Latin technical token with its Arabic pronunciation. Used
 * only for the rebuilt Arabic spoken sentence, never for the subtitles.
 */
const transliterateRemainingLatin = (text) => {
  let out = String(text || "");
  const tokens = latinTokens(out);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    out =
      out.slice(0, token.start) +
      transliterateToArabic(token.value) +
      out.slice(token.end);
  }
  return out.replace(/\s+/g, " ").trim();
};

const replaceTermsWithSpoken = (text, terms, targetLanguage) => {
  let out = String(text || "");
  for (const term of sortByLength(terms)) {
    const spokenForm = getSpokenForm(term, targetLanguage);
    if (!spokenForm) continue;
    if (termRegex(term.canonical, "i").test(out)) {
      out = out.replace(termRegex(term.canonical, "gi"), spokenForm);
    }
  }
  // A subtitle can write "الـ terminal"; the narration must not read the
  // article marker and the tatweel aloud before the term.
  return out
    .replace(/\s*\u0627\u0644\u0640\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Repairs the subtitle text and the spoken (TTS) text of one translated
 * segment so every technical term is written and pronounced exactly right.
 *
 * The voice, the language and the dialect are never changed: only the
 * characters of the technical terms are corrected.
 */
export const repairTechnicalTerms = ({
  text,
  spokenText = "",
  sourceText = "",
  targetLanguage = "ar",
}) => {
  const terms = findTermsInSource(normalizeTechnicalSource(sourceText));
  if (!terms.length) {
    return { text: String(text || ""), spokenText: String(spokenText || "") };
  }

  let repairedText = repairTextWithTerms(text, terms);
  let repairedSpoken = repairSpokenWithTerms(spokenText, terms, targetLanguage);

  if (String(spokenText || "").trim()) {
    // Only the terms that the subtitle actually shows must be spoken: when the
    // translation legitimately used an Arabic word ("الإعدادات" for Settings),
    // forcing the transliteration into the narration would make it worse.
    const required = terms.filter((term) =>
      hasCanonical(repairedText, term.canonical),
    );
    const missing = required.filter(
      (term) => !spokenMentionsTerm(repairedSpoken, term, targetLanguage),
    );

    if (missing.length > 0) {
      // Disabled: the rebuild (replaceTermsWithSpoken) sometimes reordered
      // terms ("CD image" before "Guest Additions"). The spoken text is
      // already repaired by repairSpokenWithTerms above, which is safer.
    }

    // An Arabic dub must never hand a Latin word to the Arabic voice: it reads
    // it with English pronunciation, which is exactly what "erminal" was.
    if (!usesLatinScript(targetLanguage) && /[A-Za-z]/.test(repairedSpoken)) {
      repairedSpoken = transliterateRemainingLatin(repairedSpoken);
    }

    // The burned subtitles must show the sentence that is actually spoken, so
    // technical terms stay in the same (Arabic) form in text and narration.
    // For an Arabic dub no Latin word may remain in the subtitle text.
    if (!usesLatinScript(targetLanguage) && /[A-Za-z]/.test(repairedText)) {
      for (const term of sortByLength(terms)) {
        const spokenForm = getSpokenForm(term, targetLanguage);
        if (!spokenForm) continue;
        if (termRegex(term.canonical, "i").test(repairedText)) {
          repairedText = repairedText.replace(
            termRegex(term.canonical, "gi"),
            spokenForm,
          );
        }
      }
      repairedText = repairedText
        .replace(/\s*\u0627\u0644\u0640\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  return { text: repairedText, spokenText: repairedSpoken };
};

/**
 * Repairs a whole stored translation. `sourceSegments` is the original
 * transcript (same order), used to know which technical terms belong to each
 * sentence.
 */
export const repairTranslationSegments = ({
  segments,
  sourceSegments = [],
  targetLanguage = "ar",
}) => {
  return (segments || []).map((segment, index) => {
    // Mongoose subdocuments do not spread their schema fields reliably, so
    // convert to a plain object first to keep start/end/timings intact.
    const plain = typeof segment?.toObject === 'function' ? segment.toObject() : (segment || {});
    const sourceText =
      plain?.sourceText || sourceSegments?.[index]?.text || "";
    const repaired = repairTechnicalTerms({
      text: plain?.text || "",
      spokenText: plain?.spokenText || "",
      sourceText,
      targetLanguage,
    });
    return { ...plain, ...repaired };
  });
};

export const TECHNICAL_GLOSSARY = GLOSSARY;
