'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 10000;
const M3U_URL = process.env.M3U_URL;

const DATA_DIR = path.join(
  os.tmpdir(),
  'gc-play-pro'
);

const DATA_FILE = path.join(
  DATA_DIR,
  'library.ndjson'
);

const META_FILE = path.join(
  DATA_DIR,
  'library.meta.json'
);

const state = {

  loaded: false,

  loading: false,

  loadedAt: null,

  total: 0,

  m3uBytes: 0,

  offsets: [],

  groups: new Map(),

  series: new Map(),

  searchCache: new Map()
};

/* =====================================================
   M3U
===================================================== */

function parseAttributes(line) {

  const out = {};

  const re =
    /([A-Za-z0-9_-]+)="([^"]*)"/g;

  let m;

  while ((m = re.exec(line))) {

    out[
      m[1].toLowerCase()
    ] = m[2];
  }

  return out;
}

/* =====================================================
   EPISÓDIOS
===================================================== */

function detectEpisode(name) {

  const s =
    String(name || '');

  let m =
    s.match(
      /\bS(\d{1,2})E(\d{1,3})\b/i
    );

  if (m) {

    return {
      season: +m[1],
      episode: +m[2]
    };
  }

  m =
    s.match(
      /\b(\d{1,2})x(\d{1,3})\b/i
    );

  if (m) {

    return {
      season: +m[1],
      episode: +m[2]
    };
  }

  m =
    s.match(
      /\bTEMPORADA\s*(\d{1,2}).*?(?:EP|EPIS[ÓO]DIO)\s*(\d{1,3})\b/i
    );

  if (m) {

    return {
      season: +m[1],
      episode: +m[2]
    };
  }

  return null;
}

function cleanSeriesName(name) {

  return String(name || '')

    .replace(
      /\bS\d{1,2}E\d{1,3}\b/ig,
      ''
    )

    .replace(
      /\b\d{1,2}x\d{1,3}\b/ig,
      ''
    )

    .replace(
      /\bTEMPORADA\s*\d{1,2}\b/ig,
      ''
    )

    .replace(
      /[._]+/g,
      ' '
    )

    .replace(
      /\s{2,}/g,
      ' '
    )

    .trim();
}

/* =====================================================
   CLASSIFICAÇÃO
===================================================== */

function classify(name, group) {

  const text =
    `${group || ''} ${name || ''}`
      .toLowerCase();

  const ep =
    detectEpisode(name);

  if (
    ep ||
    /series|série|temporada|season|epis[oó]dio|novela/.test(text)
  ) {

    return 'series';
  }

  if (
    /filme|movie|cinema|vod/.test(text)
  ) {

    return 'vod';
  }

  if (
    /m[úu]sica|music|radio|rádio/.test(text)
  ) {

    return 'music';
  }

  return 'live';
}

/* =====================================================
   METADADOS DE SÉRIES
===================================================== */

function addSeriesMeta(item) {

  const ep =
    detectEpisode(item.name);

  if (
    !ep &&
    classify(
      item.name,
      item.group
    ) !== 'series'
  ) {

    return;
  }

  const name =
    cleanSeriesName(
      item.name
    ) ||
    item.name ||
    'Sem nome';

  const key =
    name.toLowerCase();

  let s =
    state.series.get(key);

  if (!s) {

    s = {

      id:
        `s${state.series.size + 1}`,

      name,

      logo:
        item.logo || '',

      episodeCount: 0,

      seasons:
        new Map()
    };

    state.series.set(
      key,
      s
    );
  }

  if (
    !s.logo &&
    item.logo
  ) {

    s.logo =
      item.logo;
  }

  s.episodeCount++;

  const season =
    ep
      ? ep.season
      : 1;

  s.seasons.set(
    season,
    (s.seasons.get(season) || 0) + 1
  );
}

/* =====================================================
   ARMAZENAMENTO
===================================================== */

async function resetStorage() {

  await fsp.mkdir(
    DATA_DIR,
    {
      recursive: true
    }
  );

  await fsp.rm(
    DATA_FILE,
    {
      force: true
    }
  );

  await fsp.rm(
    META_FILE,
    {
      force: true
    }
  );
}

async function loadMetaIfPresent() {

  try {

    const meta =
      JSON.parse(
        await fsp.readFile(
          META_FILE,
          'utf8'
        )
      );

    if (
      !meta ||
      !Array.isArray(
        meta.offsets
      )
    ) {

      return false;
    }

    state.offsets =
      meta.offsets;

    state.total =
      meta.total ||
      state.offsets.length;

    state.loadedAt =
      meta.loadedAt ||
      null;

    state.m3uBytes =
      meta.m3uBytes ||
      0;

    state.groups =
      new Map(
        meta.groups || []
      );

    state.series =
      new Map(
        (meta.series || [])
          .map(
            ([k, v]) => [
              k,
              {
                ...v,
                seasons:
                  new Map(
                    v.seasons || []
                  )
              }
            ]
          )
      );

    state.loaded =
      state.total > 0 &&
      fs.existsSync(
        DATA_FILE
      );

    return state.loaded;

  } catch (_) {

    return false;
  }
}

async function saveMeta() {

  const meta = {

    total:
      state.total,

    loadedAt:
      state.loadedAt,

    m3uBytes:
      state.m3uBytes,

    offsets:
      state.offsets,

    groups:
      [...state.groups.entries()],

    series:
      [...state.series.entries()]
        .map(
          ([k, v]) => [
            k,
            {
              ...v,
              seasons:
                [...v.seasons.entries()]
            }
          ]
        )
  };

  await fsp.writeFile(
    META_FILE,
    JSON.stringify(meta)
  );
}

/* =====================================================
   LEITURA INDIVIDUAL
===================================================== */

async function readItem(index) {

  const offset =
    state.offsets[index];

  if (
    offset == null
  ) {

    return null;
  }

  const fd =
    await fsp.open(
      DATA_FILE,
      'r'
    );

  try {

    const stat =
      await fd.stat();

    const max =
      Math.min(
        8192,
        Math.max(
          256,
          stat.size - offset
        )
      );

    const buf =
      Buffer.allocUnsafe(
        max
      );

    const {
      bytesRead
    } =
      await fd.read(
        buf,
        0,
        max,
        offset
      );

    const line =
      buf
        .subarray(
          0,
          bytesRead
        )
        .toString('utf8')
        .split(
          '\n',
          1
        )[0];

    return JSON.parse(
      line
    );

  } finally {

    await fd.close();
  }
}

/* =====================================================
   LEITURA DE PÁGINA
===================================================== */

async function readPage(indices) {

  if (
    !indices.length
  ) {

    return [];
  }

  const fd =
    await fsp.open(
      DATA_FILE,
      'r'
    );

  try {

    const out = [];

    const stat =
      await fd.stat();

    for (
      const index
      of indices
    ) {

      const offset =
        state.offsets[index];

      const max =
        Math.min(
          8192,
          Math.max(
            256,
            stat.size - offset
          )
        );

      const buf =
        Buffer.allocUnsafe(
          max
        );

      const {
        bytesRead
      } =
        await fd.read(
          buf,
          0,
          max,
          offset
        );

      const line =
        buf
          .subarray(
            0,
            bytesRead
          )
          .toString('utf8')
          .split(
            '\n',
            1
          )[0];

      out.push(
        JSON.parse(line)
      );
    }

    return out;

  } finally {

    await fd.close();
  }
}

/* =====================================================
   SCAN DE ARQUIVO
===================================================== */

async function scanFile(
  predicate
) {

  const result = [];

  const stream =
    fs.createReadStream(
      DATA_FILE,
      {
        encoding: 'utf8',
        highWaterMark:
          1024 * 1024
      }
    );

  let carry = '';

  let index = 0;

  for await (
    const chunk
    of stream
  ) {

    carry += chunk;

    const lines =
      carry.split('\n');

    carry =
      lines.pop() || '';

    for (
      const line
      of lines
    ) {

      if (!line) {

        index++;

        continue;
      }

      let item;

      try {

        item =
          JSON.parse(line);

      } catch (_) {

        index++;

        continue;
      }

      if (
        predicate(item)
      ) {

        result.push(
          index
        );
      }

      index++;
    }
  }

  if (carry) {

    try {

      if (
        predicate(
          JSON.parse(carry)
        )
      ) {

        result.push(index);
      }

    } catch (_) {}
  }

  return result;
}

/* =====================================================
   CARREGADOR M3U
===================================================== */

async function parseM3UStreaming() {

  if (!M3U_URL) {

    throw new Error(
      'M3U_URL não configurada no Render.'
    );
  }

  await resetStorage();

  state.offsets = [];

  state.groups =
    new Map();

  state.series =
    new Map();

  state.searchCache =
    new Map();

  const response =
    await fetch(
      M3U_URL,
      {
        headers: {
          'User-Agent':
            'GC-PLAY-PRO/1.4',

          'Accept':
            '*/*'
        }
      }
    );

  if (
    !response.ok ||
    !response.body
  ) {

    throw new Error(
      `M3U HTTP ${response.status}`
    );
  }

  const handle =
    await fsp.open(
      DATA_FILE,
      'w'
    );

  let filePos = 0;

  let bytes = 0;

  let buffer = '';

  let pending = null;

  const writeItem =
    async url => {

      if (
        !pending ||
        !url
      ) {

        return;
      }

      const item = {

        id:
          `i${state.offsets.length}`,

        name:
          pending.name ||
          'Sem nome',

        logo:
          pending.logo ||
          '',

        group:
          pending.group ||
          'Geral',

        tvgId:
          pending.tvgId ||
          '',

        type:
          classify(
            pending.name,
            pending.group
          ),

        url
      };

      const line =
        JSON.stringify(item) +
        '\n';

      state.offsets.push(
        filePos
      );

      await handle.write(
        line,
        null,
        'utf8'
      );

      filePos +=
        Buffer.byteLength(
          line
        );

      state.total++;

      state.groups.set(
        item.group,
        (
          state.groups.get(
            item.group
          ) || 0
        ) + 1
      );

      addSeriesMeta(
        item
      );

      pending = null;
    };

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder(
      'utf-8'
    );

  try {

    while (true) {

      const {
        value,
        done
      } =
        await reader.read();

      if (done) {
        break;
      }

      bytes +=
        value.byteLength;

      buffer +=
        decoder.decode(
          value,
          {
            stream: true
          }
        );

      const lines =
        buffer.split(
          /\r?\n/
        );

      buffer =
        lines.pop() || '';

      for (
        const raw
        of lines
      ) {

        const line =
          raw.trim();

        if (!line) {
          continue;
        }

        if (
          line.startsWith(
            '#EXTINF:'
          )
        ) {

          const comma =
            line.indexOf(',');

          const attrs =
            parseAttributes(
              line
            );

          pending = {

            name:
              attrs['tvg-name'] ||
              (
                comma >= 0
                  ? line
                      .slice(
                        comma + 1
                      )
                      .trim()
                  : 'Sem nome'
              ),

            logo:
              attrs['tvg-logo'] ||
              attrs.logo ||
              '',

            group:
              attrs['group-title'] ||
              'Geral',

            tvgId:
              attrs['tvg-id'] ||
              ''
          };

        } else if (
          !line.startsWith('#') &&
          pending
        ) {

          await writeItem(
            line
          );
        }
      }
    }

    buffer +=
      decoder.decode();

    if (
      buffer.trim() &&
      !buffer
        .trim()
        .startsWith('#') &&
      pending
    ) {

      await writeItem(
        buffer.trim()
      );
    }

  } finally {

    await reader
      .cancel()
      .catch(() => {});

    await handle.close();
  }

  state.m3uBytes =
    bytes;

  state.loadedAt =
    new Date()
      .toISOString();

  state.loaded =
    true;

  await saveMeta();
}

/* =====================================================
   GARANTIR BIBLIOTECA
===================================================== */

async function ensureLibrary() {

  if (
    state.loaded
  ) {

    return;
  }

  if (
    await loadMetaIfPresent()
  ) {

    return;
  }

  if (
    state.loading
  ) {

    while (
      state.loading
    ) {

      await new Promise(
        r =>
          setTimeout(
            r,
            100
          )
      );
    }

    return;
  }

  state.loading =
    true;

  try {

    await parseM3UStreaming();

  } finally {

    state.loading =
      false;
  }
}

/* =====================================================
   PAGINAÇÃO
===================================================== */

function pageResult(
  total,
  page,
  limit
) {

  const l =
    Math.min(
      Math.max(
        Number(limit) || 40,
        1
      ),
      200
    );

  const p =
    Math.max(
      Number(page) || 1,
      1
    );

  const pages =
    Math.max(
      1,
      Math.ceil(
        total / l
      )
    );

  const current =
    Math.min(
      p,
      pages
    );

  return {

    page:
      current,

    limit:
      l,

    total,

    totalPages:
      pages,

    start:
      (current - 1) *
      l
  };
}

/* =====================================================
   MPEG-TS / MPTS
===================================================== */

const STREAM_TYPES = {

  0x02:
    'MPEG-2 video',

  0x03:
    'MPEG-1 audio',

  0x04:
    'MPEG-2 audio',

  0x0f:
    'AAC',

  0x11:
    'AAC-LATM',

  0x1b:
    'H.264/AVC',

  0x24:
    'H.265/HEVC',

  0x81:
    'AC-3',

  0x87:
    'E-AC-3'
};

function pidOf(packet) {

  return (
    ((packet[1] & 0x1f) << 8) |
    packet[2]
  );
}

function payload(packet) {

  const af =
    (packet[3] >> 4) & 3;

  if (af === 1) {

    return packet.subarray(4);
  }

  if (af === 3) {

    const n =
      packet[4];

    return (
      n + 5 <= 188
        ? packet.subarray(
            n + 5
          )
        : Buffer.alloc(0)
    );
  }

  return Buffer.alloc(0);
}

function section(packet) {

  const q =
    payload(packet);

  if (
    !q.length ||
    !(packet[1] & 0x40)
  ) {

    return null;
  }

  const ptr =
    q[0];

  return (
    ptr + 1 < q.length
      ? q.subarray(
          ptr + 1
        )
      : null
  );
}

function pat(packet) {

  const s =
    section(packet);

  if (
    !s ||
    s[0] !== 0 ||
    s.length < 12
  ) {

    return [];
  }

  const len =
    ((s[1] & 15) << 8) |
    s[2];

  const end =
    Math.min(
      s.length,
      3 + len - 4
    );

  const result = [];

  for (
    let i = 8;
    i + 4 <= end;
    i += 4
  ) {

    const program =
      (s[i] << 8) |
      s[i + 1];

    const pmtPid =
      ((s[i + 2] & 31) << 8) |
      s[i + 3];

    if (program) {

      result.push({
        program,
        pmtPid
      });
    }
  }

  return result;
}

function pmt(
  packet,
  wantedPid
) {

  if (
    pidOf(packet) !==
    wantedPid
  ) {

    return null;
  }

  const s =
    section(packet);

  if (
    !s ||
    s[0] !== 2 ||
    s.length < 16
  ) {

    return null;
  }

  const len =
    ((s[1] & 15) << 8) |
    s[2];

  const end =
    Math.min(
      s.length,
      3 + len - 4
    );

  const program =
    (s[3] << 8) |
    s[4];

  const pcrPid =
    ((s[8] & 31) << 8) |
    s[9];

  const info =
    ((s[10] & 15) << 8) |
    s[11];

  let offset =
    12 + info;

  const streams = [];

  while (
    offset + 5 <= end
  ) {

    const streamType =
      s[offset];

    const pid =
      ((s[offset + 1] & 31) << 8) |
      s[offset + 2];

    const infoLength =
      ((s[offset + 3] & 15) << 8) |
      s[offset + 4];

    streams.push({

      pid,

      streamType,

      codec:
        STREAM_TYPES[
          streamType
        ] ||
        `0x${streamType
          .toString(16)}`
    });

    offset +=
      5 + infoLength;
  }

  return {

    program,

    pcrPid,

    streams
  };
}

function scanTs(buffer) {

  let start = -1;

  for (
    let i = 0;
    i + 376 < buffer.length;
    i++
  ) {

    if (
      buffer[i] === 71 &&
      buffer[i + 188] === 71 &&
      buffer[i + 376] === 71
    ) {

      start = i;

      break;
    }
  }

  if (
    start < 0
  ) {

    return {

      aligned: false,

      programs: []
    };
  }

  const pats =
    new Map();

  const pmts =
    new Map();

  for (
    let offset = start;
    offset + 188 <= buffer.length;
    offset += 188
  ) {

    const packet =
      buffer.subarray(
        offset,
        offset + 188
      );

    if (
      packet[0] !== 71
    ) {

      break;
    }

    const pid =
      pidOf(packet);

    if (
      pid === 0
    ) {

      for (
        const x
        of pat(packet)
      ) {

        pats.set(
          x.program,
          x
        );
      }
    }

    for (
      const x
      of pats.values()
    ) {

      if (
        pid === x.pmtPid &&
        !pmts.has(
          x.program
        )
      ) {

        const y =
          pmt(
            packet,
            x.pmtPid
          );

        if (y) {

          pmts.set(
            x.program,
            y
          );
        }
      }
    }

    if (
      pats.size &&
      pmts.size ===
      pats.size
    ) {

      break;
    }
  }

  const programs = [];

  for (
    const [
      program,
      x
    ]
    of pats
  ) {

    const y =
      pmts.get(
        program
      );

    programs.push({

      program,

      pmtPid:
        x.pmtPid,

      pcrPid:
        y?.pcrPid ??
        null,

      streams:
        y?.streams ||
        []
    });
  }

  return {

    aligned: true,

    programs
  };
}

async function sampleStream(
  url,
  max = 262144
) {

  const r =
    await fetch(
      url,
      {
        headers: {

          'User-Agent':
            'GC-PLAY-PRO-MPTS/1.4',

          'Accept':
            '*/*'
        }
      }
    );

  if (
    !r.ok ||
    !r.body
  ) {

    throw new Error(
      `Stream HTTP ${r.status}`
    );
  }

  const rd =
    r.body.getReader();

  const chunks = [];

  let total = 0;

  try {

    while (
      total < max
    ) {

      const {
        value,
        done
      } =
        await rd.read();

      if (done) {
        break;
      }

      const take =
        Math.min(
          value.byteLength,
          max - total
        );

      chunks.push(
        Buffer.from(
          value.subarray(
            0,
            take
          )
        )
      );

      total += take;

      if (
        take <
        value.byteLength
      ) {

        break;
      }
    }

  } finally {

    await rd
      .cancel()
      .catch(() => {});
  }

  return Buffer.concat(
    chunks,
    total
  );
}

async function findItem(id) {

  const n =
    Number(
      String(id)
        .replace(/^i/, '')
    );

  if (
    !Number.isInteger(n) ||
    n < 0 ||
    n >= state.total
  ) {

    return null;
  }

  return readItem(n);
}

/* =====================================================
   MPTS → SPTS
===================================================== */

async function streamMpts(
  item,
  programNumber,
  res
) {

  const up =
    await fetch(
      item.url,
      {
        headers: {

          'User-Agent':
            'GC-PLAY-PRO-MPTS/1.4',

          'Accept':
            '*/*'
        }
      }
    );

  if (
    !up.ok ||
    !up.body
  ) {

    throw new Error(
      `Stream HTTP ${up.status}`
    );
  }

  res.status(200);

  res.setHeader(
    'Content-Type',
    'video/mp2t'
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.flushHeaders?.();

  const reader =
    up.body.getReader();

  let pending =
    Buffer.alloc(0);

  let selected =
    null;

  let buffered = [];

  const emit =
    packet => {

      if (
        !res.destroyed
      ) {

        res.write(
          packet
        );
      }
    };

  try {

    while (true) {

      const {
        value,
        done
      } =
        await reader.read();

      if (done) {
        break;
      }

      pending =
        Buffer.concat([
          pending,
          Buffer.from(value)
        ]);

      let sync = -1;

      for (
        let i = 0;
        i + 376 <
        pending.length;
        i++
      ) {

        if (
          pending[i] === 71 &&
          pending[i + 188] === 71 &&
          pending[i + 376] === 71
        ) {

          sync = i;

          break;
        }
      }

      if (
        sync < 0
      ) {

        if (
          pending.length >
          4096
        ) {

          pending =
            pending.subarray(
              pending.length -
              4096
            );
        }

        continue;
      }

      if (
        sync > 0
      ) {

        pending =
          pending.subarray(
            sync
          );
      }

      const whole =
        Math.floor(
          pending.length /
          188
        ) * 188;

      const data =
        pending.subarray(
          0,
          whole
        );

      pending =
        pending.subarray(
          whole
        );

      for (
        let offset = 0;
        offset < data.length;
        offset += 188
      ) {

        const packet =
          data.subarray(
            offset,
            offset + 188
          );

        const pid =
          pidOf(packet);

        if (!selected) {

          buffered.push(
            Buffer.from(
              packet
            )
          );

          const scan =
            scanTs(
              Buffer.concat(
                buffered
              )
            );

          if (
            scan.programs.length
          ) {

            const program =
              scan.programs.find(
                x =>
                  x.program ===
                  programNumber
              ) ||
              (
                programNumber ==
                null
                  ? scan.programs[0]
                  : null
              );

            if (
              program &&
              program.streams.length
            ) {

              const pids =
                new Set([
                  0,
                  program.pmtPid,
                  program.pcrPid,
                  ...program.streams
                    .map(
                      x =>
                        x.pid
                    )
                ]);

              selected =
                pids;

              for (
                const old
                of buffered
              ) {

                if (
                  pids.has(
                    pidOf(old)
                  )
                ) {

                  emit(old);
                }
              }

              buffered = [];
            }
          }

          if (
            buffered.length >
            1500
          ) {

            buffered =
              buffered.slice(
                -400
              );
          }

          continue;
        }

        if (
          selected.has(pid)
        ) {

          emit(
            packet
          );
        }
      }
    }

  } finally {

    await reader
      .cancel()
      .catch(() => {});

    if (
      !res.destroyed
    ) {

      res.end();
    }
  }
}

/* =====================================================
   ROTAS
===================================================== */

app.get(
  '/',
  (_req, res) => {

    res.json({

      status:
        'online',

      app:
        'GC PLAY PRO',

      version:
        '1.4.0',

      message:
        'Backend memory-safe + M3U + Series + MPTS'
    });
  }
);

app.get(
  '/api/status',
  (_req, res) => {

    res.json({

      status:
        'online',

      app:
        'GC PLAY PRO',

      version:
        '1.4.0',

      libraryLoaded:
        state.loaded,

      total:
        state.total,

      series:
        state.series.size,

      loadedAt:
        state.loadedAt
    });
  }
);

app.get(
  '/api/library/status',
  async (_req, res) => {

    try {

      await ensureLibrary();

      res.json({

        status:
          'online',

        loaded:
          state.loaded,

        loading:
          state.loading,

        total:
          state.total,

        groups:
          state.groups.size,

        series:
          state.series.size,

        loadedAt:
          state.loadedAt,

        m3uBytes:
          state.m3uBytes
      });

    } catch (e) {

      res
        .status(500)
        .json({
          error:
            e.message
        });
    }
  }
);

app.get(
  '/api/library',
  async (_req, res) => {

    try {

      await ensureLibrary();

      res.json({

        total:
          state.total,

        groups:
          [
            ...state.groups.entries()
          ]
            .map(
              ([name, count]) => ({
                name,
                count
              })
            ),

        series:
          state.series.size,

        loadedAt:
          state.loadedAt
      });

    } catch (e) {

      res
        .status(500)
        .json({
          error:
            e.message
        });
    }
  }
);

app.get(
  '/api/library/items',
  async (req, res) => {

    try {

      await ensureLibrary();

      const group =
        String(
          req.query.group ||
          ''
        )
          .trim()
          .toLowerCase();

      const search =
        String(
          req.query.search ||
          ''
        )
          .trim()
          .toLowerCase();

      let indices;

      if (
        !group &&
        !search
      ) {

        const pg =
          pageResult(
            state.total,
            req.query.page,
            req.query.limit
          );

        const pageIndices =
          [];

        for (
          let i =
            pg.start;
          i <
            pg.start +
              pg.limit &&
          i <
            state.total;
          i++
        ) {

          pageIndices.push(i);
        }

        const items =
          await readPage(
            pageIndices
          );

        return res.json({

          page:
            pg.page,

          limit:
            pg.limit,

          total:
            pg.total,

          totalPages:
            pg.totalPages,

          items
        });
      }

      const cacheKey =
        `${group}|${search}`;

      indices =
        state.searchCache.get(
          cacheKey
        );

      if (
        !indices
      ) {

        indices =
          await scanFile(
            item => {

              const okGroup =
                !group ||
                String(
                  item.group
                )
                  .toLowerCase() ===
                  group;

              const okSearch =
                !search ||
                `${item.name} ${item.group} ${item.tvgId}`
                  .toLowerCase()
                  .includes(search);

              return (
                okGroup &&
                okSearch
              );
            }
          );

        if (
          state.searchCache.size >
          10
        ) {

          state.searchCache.delete(
            state.searchCache
              .keys()
              .next()
              .value
          );
        }

        state.searchCache.set(
          cacheKey,
          indices
        );
      }

      const pg =
        pageResult(
          indices.length,
          req.query.page,
          req.query.limit
        );

      const pageIndices =
        indices.slice(
          pg.start,
          pg.start +
            pg.limit
        );

      const items =
        await readPage(
          pageIndices
        );

      res.json({

        page:
          pg.page,

        limit:
          pg.limit,

        total:
          pg.total,

        totalPages:
          pg.totalPages,

        items
      });

    } catch (e) {

      res
        .status(500)
        .json({
          error:
            e.message
        });
    }
  }
);

app.post(
  '/api/library/refresh',
  async (_req, res) => {

    try {

      state.loaded =
        false;

      await ensureLibrary();

      res.json({

        ok:
          true,

        total:
          state.total,

        series:
          state.series.size
      });

    } catch (e) {

      res
        .status(500)
        .json({
          error:
            e.message
        });
    }
  }
);

/* =====================================================
   SERIES
===================================================== */

app.get(
  '/api/series',
  async (req, res) => {

    try {

      await ensureLibrary();

      let list =
        [
          ...state.series.values()
        ]
          .map(
            s => ({

              id:
                s.id,

              name:
                s.name,

              logo:
                s.logo,

              episodeCount:
                s.episodeCount,

              seasons:
                [
                  ...s.seasons.keys()
                ]
                  .sort(
                    (a, b) =>
                      a - b
                  )
            })
          );

      const search =
        String(
          req.query.search ||
          ''
        )
          .trim()
          .toLowerCase();

      if (search) {

        list =
          list.filter(
            s =>
              s.name
                .toLowerCase()
                .includes(
                  search
                )
          );
      }

      const pg =
        pageResult(
          list.length,
          req.query.page,
          req.query.limit
        );

      res.json({

        page:
          pg.page,

        limit:
          pg.limit,

        total:
          pg.total,

        totalPages:
          pg.totalPages,

        items:
          list.slice(
            pg.start,
            pg.start +
              pg.limit
          )
      });

    } catch (e) {

      res
        .status(500)
        .json({
          error:
            e.message
        });
    }
  }
);

app.get(
  '/api/series/:id',
  async (req, res) => {

    try {

      await ensureLibrary();

      const s =
        [
          ...state.series.values()
        ]
          .find(
            x =>
              x.id ===
              req.params.id
          );

      if (!s) {

        return res
          .status(404)
          .json({
            error:
              'Série não encontrada.'
          });
      }

      const episodes = [];

      const target =
        s.name.toLowerCase();

      await scanFile(
        item => {

          const ep =
            detectEpisode(
              item.name
            );

          if (
            cleanSeriesName(
              item.name
            )
              .toLowerCase() ===
            target
          ) {

            episodes.push({

              ...item,

              season:
                ep?.season ||
                1,

              episode:
                ep?.episode ||
                1,

              title:
                String(
                  item.name ||
                  ''
                )
                  .replace(
                    /\bS\d{1,2}E\d{1,3}\b/ig,
                    ''
                  )
                  .trim() ||
                item.name
            });
          }

          return false;
        }
      );

      const seasons =
        new Map();

      for (
        const e
        of episodes
      ) {

        if (
          !seasons.has(
            e.season
          )
        ) {

          seasons.set(
            e.season,
            {
              number:
                e.season,

              episodes:
                []
            }
          );
        }

        seasons
          .get(
            e.season
          )
          .episodes
          .push(e);
      }

      for (
        const v
        of seasons.values()
      ) {

        v.episodes.sort(
          (a, b) =>
            a.episode -
            b.episode
        );
      }

      res.json({

        id:
          s.id,

        name:
          s.name,

        logo:
          s.logo,

        episodeCount:
          s.episodeCount,

        seasons:
          [
            ...seasons.values()
          ]
            .sort(
              (a, b) =>
                a.number -
                b.number
            )
      });

    } catch (e) {

      res
        .status(500)
        .json({
          error:
            e.message
        });
    }
  }
);

/* =====================================================
   MPTS INSPECT
===================================================== */

app.get(
  '/api/mpts/inspect/:id',
  async (req, res) => {

    try {

      await ensureLibrary();

      const item =
        await findItem(
          req.params.id
        );

      if (!item) {

        return res
          .status(404)
          .json({
            error:
              'Conteúdo não encontrado.'
          });
      }

      if (
        !/^https?:\/\//i.test(
          item.url
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              'Este stream não usa HTTP/HTTPS.'
          });
      }

      const sample =
        await sampleStream(
          item.url
        );

      const result =
        scanTs(
          sample
        );

      res.json({

        ok:
          true,

        id:
          item.id,

        name:
          item.name,

        bytesAnalyzed:
          sample.length,

        transportStream:
          result.aligned,

        mode:
          result.programs.length > 1
            ? 'MPTS'
            : result.programs.length === 1
              ? 'SPTS'
              : 'UNKNOWN',

        programCount:
          result.programs.length,

        programs:
          result.programs
      });

    } catch (e) {

      res
        .status(502)
        .json({

          error:
            'Não foi possível analisar o stream.',

          detail:
            e.message
        });
    }
  }
);

/* =====================================================
   MPTS STREAM
===================================================== */

app.get(
  '/api/mpts/stream/:id',
  async (req, res) => {

    try {

      await ensureLibrary();

      const item =
        await findItem(
          req.params.id
        );

      if (!item) {

        return res
          .status(404)
          .json({
            error:
              'Conteúdo não encontrado.'
          });
      }

      if (
        !/^https?:\/\//i.test(
          item.url
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              'Este stream não usa HTTP/HTTPS.'
          });
      }

      const program =
        req.query.program ===
        undefined
          ? null
          : Number(
              req.query.program
            );

      if (
        program !== null &&
        !Number.isInteger(
          program
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              'Programa inválido.'
          });
      }

      await streamMpts(
        item,
        program,
        res
      );

    } catch (e) {

      if (
        !res.headersSent
      ) {

        res
          .status(502)
          .json({

            error:
              'Não foi possível iniciar o MPTS.',

            detail:
              e.message
          });

      } else if (
        !res.destroyed
      ) {

        res.end();
      }
    }
  }
);

/* =====================================================
   START
===================================================== */

app.listen(
  PORT,
  () => {

    console.log(
      '================================'
    );

    console.log(
      'GC PLAY PRO BACKEND 1.4.0'
    );

    console.log(
      'MEMORY SAFE: ATIVO'
    );

    console.log(
      'M3U + SERIES + MPTS'
    );

    console.log(
      `PORTA: ${PORT}`
    );

    console.log(
      '================================'
    );
  }
);
