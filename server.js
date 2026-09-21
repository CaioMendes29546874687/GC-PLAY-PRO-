'use strict';

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 10000;
const M3U_URL = process.env.M3U_URL;

const state = {
  items: [],
  groups: new Map(),
  series: new Map(),
  loaded: false,
  loading: false,
  loadedAt: null,
  total: 0,
  m3uBytes: 0
};

/* =========================================================
   M3U
========================================================= */

function parseAttributes(line) {
  const result = {};
  const regex = /([A-Za-z0-9_-]+)="([^"]*)"/g;

  let match;

  while ((match = regex.exec(line))) {
    result[match[1].toLowerCase()] = match[2];
  }

  return result;
}

/* =========================================================
   SERIES
========================================================= */

function detectEpisode(name) {

  const text = String(name || '');

  let m = text.match(/\bS(\d{1,2})E(\d{1,3})\b/i);

  if (m) {
    return {
      season: Number(m[1]),
      episode: Number(m[2])
    };
  }

  m = text.match(/\b(\d{1,2})x(\d{1,3})\b/i);

  if (m) {
    return {
      season: Number(m[1]),
      episode: Number(m[2])
    };
  }

  m = text.match(
    /\bT(?:EMPORADA)?\s*(\d{1,2})\s*(?:EP|EPIS[ÓO]DIO)\s*(\d{1,3})\b/i
  );

  if (m) {
    return {
      season: Number(m[1]),
      episode: Number(m[2])
    };
  }

  m = text.match(
    /\bTEMPORADA\s*(\d{1,2}).*?EP(?:IS[ÓO]DIO)?\s*(\d{1,3})\b/i
  );

  if (m) {
    return {
      season: Number(m[1]),
      episode: Number(m[2])
    };
  }

  return null;
}

function cleanSeriesName(name) {

  return String(name || '')
    .replace(/\bS\d{1,2}E\d{1,3}\b/ig, '')
    .replace(/\b\d{1,2}x\d{1,3}\b/ig, '')
    .replace(
      /\bT(?:EMPORADA)?\s*\d{1,2}\s*(?:EP|EPIS[ÓO]DIO)\s*\d{1,3}\b/ig,
      ''
    )
    .replace(/\bTEMPORADA\s*\d{1,2}\b/ig, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isSeries(item, episode) {

  const text =
    `${item.name || ''} ${item.group || ''}`.toLowerCase();

  return !!episode ||
    /series|série|temporada|season|epis[oó]dio|novela/.test(text);
}

function addSeriesEpisode(item, episode) {

  const name = cleanSeriesName(item.name);

  const key = name.toLowerCase();

  let series = state.series.get(key);

  if (!series) {

    series = {
      id: 's' + (state.series.size + 1),
      name,
      logo: item.logo || '',
      seasons: new Map(),
      episodeCount: 0
    };

    state.series.set(key, series);
  }

  if (item.logo && !series.logo) {
    series.logo = item.logo;
  }

  let season = series.seasons.get(episode.season);

  if (!season) {

    season = {
      number: episode.season,
      episodes: []
    };

    series.seasons.set(
      episode.season,
      season
    );
  }

  const episodeItem = {

    id: item.id,

    season: episode.season,

    episode: episode.episode,

    title: String(item.name || '')
      .replace(/\bS\d{1,2}E\d{1,3}\b/ig, '')
      .trim(),

    name: item.name,

    logo: item.logo,

    group: item.group,

    tvgId: item.tvgId,

    url: item.url
  };

  const exists =
    season.episodes.some(
      x => x.id === episodeItem.id
    );

  if (!exists) {

    season.episodes.push(
      episodeItem
    );

    series.episodeCount++;
  }
}

/* =========================================================
   CLASSIFICAÇÃO
========================================================= */

function classify(item) {

  const episode = detectEpisode(
    item.name
  );

  if (isSeries(item, episode)) {

    if (episode) {
      addSeriesEpisode(
        item,
        episode
      );
    }

    return 'series';
  }

  const text =
    `${item.group || ''} ${item.name || ''}`
      .toLowerCase();

  if (
    /filme|movie|cinema|vod/.test(text)
  ) {
    return 'vod';
  }

  if (
    /m[úu]sica|music|radio|r[aá]dio/.test(text)
  ) {
    return 'music';
  }

  return 'live';
}

function addItem(item) {

  item.id =
    'i' + state.items.length;

  item.type =
    classify(item);

  state.items.push(item);

  if (!state.groups.has(item.group)) {
    state.groups.set(
      item.group,
      []
    );
  }

  state.groups
    .get(item.group)
    .push(item);
}

/* =========================================================
   CARREGAMENTO DA M3U
========================================================= */

async function loadM3U() {

  if (!M3U_URL) {

    throw new Error(
      'M3U_URL não configurada no Render.'
    );
  }

  if (state.loading) {
    return;
  }

  state.loading = true;

  state.items = [];
  state.groups.clear();
  state.series.clear();

  try {

    console.log(
      'GC PLAY PRO: carregando M3U...'
    );

    const response =
      await fetch(M3U_URL, {
        headers: {
          'User-Agent':
            'GC-PLAY-PRO/1.3.1',

          'Accept':
            '*/*'
        }
      });

    if (!response.ok) {

      throw new Error(
        `M3U HTTP ${response.status}`
      );
    }

    if (!response.body) {

      throw new Error(
        'Resposta M3U sem body.'
      );
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder('utf-8');

    let buffer = '';
    let pending = null;
    let bytes = 0;

    function processLine(rawLine) {

      const line =
        rawLine
          .replace(/^\uFEFF/, '')
          .trim();

      if (!line) {
        return;
      }

      if (
        line.startsWith('#EXTINF:')
      ) {

        const comma =
          line.indexOf(',');

        const title =
          comma >= 0
            ? line.slice(comma + 1).trim()
            : 'Sem título';

        const attributes =
          parseAttributes(line);

        pending = {

          name:
            attributes['tvg-name'] ||
            title,

          logo:
            attributes['tvg-logo'] ||
            attributes['logo'] ||
            '',

          group:
            attributes['group-title'] ||
            'Geral',

          tvgId:
            attributes['tvg-id'] ||
            '',

          url: ''
        };

        return;
      }

      if (
        line.startsWith('#')
      ) {
        return;
      }

      if (!pending) {
        return;
      }

      pending.url = line;

      if (pending.url) {

        addItem(pending);
      }

      pending = null;
    }

    while (true) {

      const {
        value,
        done
      } = await reader.read();

      if (done) {
        break;
      }

      bytes += value.byteLength;

      buffer +=
        decoder.decode(
          value,
          { stream: true }
        );

      const lines =
        buffer.split(/\r?\n/);

      buffer =
        lines.pop() || '';

      for (const line of lines) {
        processLine(line);
      }
    }

    buffer += decoder.decode();

    if (buffer) {
      processLine(buffer);
    }

    for (
      const series of state.series.values()
    ) {

      for (
        const season of series.seasons.values()
      ) {

        season.episodes.sort(
          (a, b) =>
            a.episode - b.episode
        );
      }
    }

    state.loaded = true;

    state.loadedAt =
      new Date().toISOString();

    state.total =
      state.items.length;

    state.m3uBytes =
      bytes;

    console.log(
      `GC PLAY PRO: ${state.total} conteúdos`
    );

    console.log(
      `GC PLAY PRO: ${state.series.size} séries`
    );

  } finally {

    state.loading = false;
  }
}

async function ensureLibrary() {

  if (
    !state.loaded &&
    !state.loading
  ) {

    await loadM3U();
  }

  while (state.loading) {

    await new Promise(
      resolve =>
        setTimeout(resolve, 50)
    );
  }
}

/* =========================================================
   PAGINAÇÃO
========================================================= */

function pageItems(
  items,
  page,
  limit
) {

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 40,
        1
      ),
      200
    );

  const safePage =
    Math.max(
      Number(page) || 1,
      1
    );

  const total =
    items.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total / safeLimit
      )
    );

  const currentPage =
    Math.min(
      safePage,
      totalPages
    );

  const start =
    (currentPage - 1) *
    safeLimit;

  return {

    page: currentPage,

    limit: safeLimit,

    total,

    totalPages,

    items:
      items.slice(
        start,
        start + safeLimit
      )
  };
}

function publicItem(item) {

  return {

    id: item.id,

    name: item.name,

    title: item.name,

    logo: item.logo,

    group: item.group,

    tvgId: item.tvgId,

    type: item.type,

    url: item.url
  };
}

function findItem(id) {

  return state.items.find(
    item => item.id === id
  );
}

/* =========================================================
   MPEG-TS / MPTS
========================================================= */

const STREAM_TYPES = {

  0x01:
    'MPEG-1 video',

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

function readU16(buffer, offset) {

  return (
    (buffer[offset] << 8) |
    buffer[offset + 1]
  );
}

function getPID(packet) {

  return (
    ((packet[1] & 0x1f) << 8) |
    packet[2]
  );
}

function getPayload(packet) {

  const adaptation =
    (packet[3] >> 4) & 3;

  if (adaptation === 1) {

    return packet.subarray(4);
  }

  if (adaptation === 3) {

    const length =
      packet[4];

    const start =
      5 + length;

    if (start <= 188) {

      return packet.subarray(
        start
      );
    }
  }

  return Buffer.alloc(0);
}

function getSection(packet) {

  const payload =
    getPayload(packet);

  if (!payload.length) {
    return null;
  }

  const payloadStart =
    !!(packet[1] & 0x40);

  if (!payloadStart) {
    return null;
  }

  const pointer =
    payload[0];

  if (
    pointer + 1 >=
    payload.length
  ) {
    return null;
  }

  return payload.subarray(
    1 + pointer
  );
}

/* =========================================================
   PAT
========================================================= */

function parsePAT(packet) {

  const section =
    getSection(packet);

  if (
    !section ||
    section[0] !== 0x00 ||
    section.length < 12
  ) {

    return [];
  }

  const sectionLength =
    ((section[1] & 0x0f) << 8) |
    section[2];

  const end =
    Math.min(
      section.length,
      3 + sectionLength - 4
    );

  const programs = [];

  for (
    let i = 8;
    i + 4 <= end;
    i += 4
  ) {

    const program =
      readU16(
        section,
        i
      );

    const pmtPID =
      ((section[i + 2] & 0x1f) << 8) |
      section[i + 3];

    if (program !== 0) {

      programs.push({

        program,

        pmtPid:
          pmtPID
      });
    }
  }

  return programs;
}

/* =========================================================
   PMT
========================================================= */

function parsePMT(
  packet,
  expectedPID
) {

  if (
    getPID(packet) !==
    expectedPID
  ) {
    return null;
  }

  const section =
    getSection(packet);

  if (
    !section ||
    section[0] !== 0x02 ||
    section.length < 16
  ) {

    return null;
  }

  const sectionLength =
    ((section[1] & 0x0f) << 8) |
    section[2];

  const end =
    Math.min(
      section.length,
      3 + sectionLength - 4
    );

  const program =
    readU16(
      section,
      3
    );

  const pcrPID =
    ((section[8] & 0x1f) << 8) |
    section[9];

  const programInfoLength =
    ((section[10] & 0x0f) << 8) |
    section[11];

  let offset =
    12 + programInfoLength;

  const streams = [];

  while (
    offset + 5 <= end
  ) {

    const streamType =
      section[offset];

    const elementaryPID =
      ((section[offset + 1] & 0x1f) << 8) |
      section[offset + 2];

    const esInfoLength =
      ((section[offset + 3] & 0x0f) << 8) |
      section[offset + 4];

    streams.push({

      pid:
        elementaryPID,

      streamType,

      codec:
        STREAM_TYPES[streamType] ||
        `0x${streamType
          .toString(16)
          .padStart(2, '0')}`
    });

    offset +=
      5 + esInfoLength;
  }

  return {

    program,

    pcrPid,

    streams
  };
}

/* =========================================================
   ANALISADOR TS
========================================================= */

function scanTS(buffer) {

  let start = -1;

  for (
    let i = 0;
    i + 564 <= buffer.length;
    i++
  ) {

    if (
      buffer[i] === 0x47 &&
      buffer[i + 188] === 0x47 &&
      buffer[i + 376] === 0x47
    ) {

      start = i;
      break;
    }
  }

  if (start < 0) {

    return {

      aligned: false,

      programs: []
    };
  }

  const patPrograms =
    new Map();

  const pmtPrograms =
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
      packet[0] !== 0x47
    ) {
      break;
    }

    const pid =
      getPID(packet);

    if (pid === 0) {

      const pats =
        parsePAT(packet);

      for (const p of pats) {

        patPrograms.set(
          p.program,
          p
        );
      }
    }

    for (
      const p
      of patPrograms.values()
    ) {

      if (
        pid === p.pmtPid &&
        !pmtPrograms.has(
          p.program
        )
      ) {

        const pmt =
          parsePMT(
            packet,
            p.pmtPid
          );

        if (pmt) {

          pmtPrograms.set(
            p.program,
            pmt
          );
        }
      }
    }

    if (
      patPrograms.size > 0 &&
      pmtPrograms.size ===
      patPrograms.size
    ) {

      break;
    }
  }

  const programs = [];

  for (
    const [program, pat]
    of patPrograms
  ) {

    const pmt =
      pmtPrograms.get(program);

    programs.push({

      program,

      pmtPid:
        pat.pmtPid,

      pcrPid:
        pmt
          ? pmt.pcrPid
          : null,

      streams:
        pmt
          ? pmt.streams
          : []
    });
  }

  return {

    aligned: true,

    programs
  };
}

/* =========================================================
   AMOSTRA DO STREAM
========================================================= */

async function getStreamSample(
  url,
  maxBytes = 1024 * 1024
) {

  const response =
    await fetch(
      url,
      {
        headers: {

          'User-Agent':
            'GC-PLAY-PRO-MPTS/1.3.1',

          'Accept':
            '*/*'
        }
      }
    );

  if (!response.ok) {

    throw new Error(
      `Stream HTTP ${response.status}`
    );
  }

  if (!response.body) {

    throw new Error(
      'Stream sem body.'
    );
  }

  const reader =
    response.body.getReader();

  const chunks = [];

  let total = 0;

  try {

    while (
      total < maxBytes
    ) {

      const {
        value,
        done
      } = await reader.read();

      if (done) {
        break;
      }

      const remaining =
        maxBytes - total;

      const take =
        Math.min(
          value.byteLength,
          remaining
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

    try {
      await reader.cancel();
    } catch (_) {}
  }

  return Buffer.concat(
    chunks,
    total
  );
}

/* =========================================================
   INSPEÇÃO MPTS
========================================================= */

async function inspectMPTS(
  item
) {

  const sample =
    await getStreamSample(
      item.url
    );

  const result =
    scanTS(sample);

  let mode =
    'UNKNOWN';

  if (
    result.programs.length === 1
  ) {

    mode = 'SPTS';

  } else if (
    result.programs.length > 1
  ) {

    mode = 'MPTS';
  }

  return {

    ok: true,

    id:
      item.id,

    name:
      item.name,

    bytesAnalyzed:
      sample.length,

    transportStream:
      result.aligned,

    mode,

    programCount:
      result.programs.length,

    programs:
      result.programs
  };
}

/* =========================================================
   STREAM MPTS -> SPTS
========================================================= */

async function streamMPTS(
  item,
  requestedProgram,
  res
) {

  const upstream =
    await fetch(
      item.url,
      {
        headers: {

          'User-Agent':
            'GC-PLAY-PRO-MPTS/1.3.1',

          'Accept':
            '*/*'
        }
      }
    );

  if (
    !upstream.ok ||
    !upstream.body
  ) {

    throw new Error(
      `Stream HTTP ${upstream.status}`
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
    upstream.body.getReader();

  let pending =
    Buffer.alloc(0);

  let selected =
    null;

  let buffered =
    [];

  function writePacket(packet) {

    if (!res.destroyed) {

      res.write(packet);
    }
  }

  try {

    while (true) {

      const {
        value,
        done
      } = await reader.read();

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
        i + 564 <= pending.length;
        i++
      ) {

        if (
          pending[i] === 0x47 &&
          pending[i + 188] === 0x47 &&
          pending[i + 376] === 0x47
        ) {

          sync = i;
          break;
        }
      }

      if (sync < 0) {

        if (
          pending.length > 4096
        ) {

          pending =
            pending.subarray(
              pending.length - 4096
            );
        }

        continue;
      }

      if (sync > 0) {

        pending =
          pending.subarray(sync);
      }

      const completeLength =
        Math.floor(
          pending.length / 188
        ) * 188;

      const data =
        pending.subarray(
          0,
          completeLength
        );

      pending =
        pending.subarray(
          completeLength
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
          getPID(packet);

        if (!selected) {

          buffered.push(
            Buffer.from(packet)
          );

          const sample =
            Buffer.concat(
              buffered
            );

          const scan =
            scanTS(sample);

          if (
            scan.programs.length
          ) {

            let program;

            if (
              requestedProgram !== null
            ) {

              program =
                scan.programs.find(
                  p =>
                    p.program ===
                    requestedProgram
                );

            } else {

              program =
                scan.programs[0];
            }

            if (
              program &&
              program.streams.length
            ) {

              const pids =
                new Set();

              pids.add(0);

              pids.add(
                program.pmtPid
              );

              if (
                program.pcrPid != null
              ) {

                pids.add(
                  program.pcrPid
                );
              }

              for (
                const stream
                of program.streams
              ) {

                pids.add(
                  stream.pid
                );
              }

              selected = {

                program:
                  program.program,

                pids
              };

              for (
                const oldPacket
                of buffered
              ) {

                if (
                  selected.pids.has(
                    getPID(oldPacket)
                  )
                ) {

                  writePacket(
                    oldPacket
                  );
                }
              }

              buffered = [];
            }
          }

          if (
            buffered.length > 3000
          ) {

            buffered =
              buffered.slice(
                -1000
              );
          }

          continue;
        }

        if (
          selected.pids.has(pid)
        ) {

          writePacket(packet);
        }
      }
    }

  } catch (error) {

    if (!res.destroyed) {
      res.end();
    }

    throw error;
  }

  if (!res.destroyed) {
    res.end();
  }
}

/* =========================================================
   ROTAS
========================================================= */

app.get(
  '/',
  (_req, res) => {

    res.json({

      status:
        'online',

      app:
        'GC PLAY PRO',

      version:
        '1.3.1',

      message:
        'Backend + M3U + Series + MPTS'
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
        '1.3.1',

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

/* =========================================================
   BIBLIOTECA
========================================================= */

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

    } catch (error) {

      res.status(500).json({

        error:
          error.message
      });
    }
  }
);

app.get(
  '/api/library',
  async (_req, res) => {

    try {

      await ensureLibrary();

      const groups =
        [...state.groups.entries()]
          .map(
            ([name, items]) => ({

              name,

              count:
                items.length
            })
          );

      res.json({

        total:
          state.total,

        groups,

        series:
          state.series.size,

        loadedAt:
          state.loadedAt
      });

    } catch (error) {

      res.status(500).json({

        error:
          error.message
      });
    }
  }
);

app.get(
  '/api/library/items',
  async (req, res) => {

    try {

      await ensureLibrary();

      let items =
        state.items;

      const group =
        String(
          req.query.group || ''
        )
          .trim()
          .toLowerCase();

      const search =
        String(
          req.query.search || ''
        )
          .trim()
          .toLowerCase();

      if (group) {

        items =
          items.filter(
            item =>
              String(
                item.group
              ).toLowerCase() ===
              group
          );
      }

      if (search) {

        items =
          items.filter(
            item =>
              (
                `${item.name} ` +
                `${item.group} ` +
                `${item.tvgId}`
              )
                .toLowerCase()
                .includes(search)
          );
      }

      const result =
        pageItems(
          items,
          req.query.page,
          req.query.limit
        );

      res.json({

        ...result,

        items:
          result.items.map(
            publicItem
          )
      });

    } catch (error) {

      res.status(500).json({

        error:
          error.message
      });
    }
  }
);

app.post(
  '/api/library/refresh',
  async (_req, res) => {

    try {

      state.loaded = false;

      await loadM3U();

      res.json({

        ok: true,

        total:
          state.total,

        series:
          state.series.size
      });

    } catch (error) {

      res.status(500).json({

        error:
          error.message
      });
    }
  }
);

/* =========================================================
   SERIES
========================================================= */

app.get(
  '/api/series',
  async (req, res) => {

    try {

      await ensureLibrary();

      let list =
        [...state.series.values()]
          .map(series => ({

            id:
              series.id,

            name:
              series.name,

            logo:
              series.logo,

            episodeCount:
              series.episodeCount,

            seasons:
              [...series.seasons.values()]
                .map(
                  season =>
                    season.number
                )
                .sort(
                  (a, b) => a - b
                )
          }));

      const search =
        String(
          req.query.search || ''
        )
          .trim()
          .toLowerCase();

      if (search) {

        list =
          list.filter(
            series =>
              series.name
                .toLowerCase()
                .includes(search)
          );
      }

      const result =
        pageItems(
          list,
          req.query.page,
          req.query.limit
        );

      res.json(result);

    } catch (error) {

      res.status(500).json({

        error:
          error.message
      });
    }
  }
);

app.get(
  '/api/series/:id',
  async (req, res) => {

    try {

      await ensureLibrary();

      const series =
        [...state.series.values()]
          .find(
            x =>
              x.id ===
              req.params.id
          );

      if (!series) {

        return res
          .status(404)
          .json({

            error:
              'Série não encontrada.'
          });
      }

      res.json({

        id:
          series.id,

        name:
          series.name,

        logo:
          series.logo,

        episodeCount:
          series.episodeCount,

        seasons:
          [...series.seasons.values()]
            .sort(
              (a, b) =>
                a.number -
                b.number
            )
      });

    } catch (error) {

      res.status(500).json({

        error:
          error.message
      });
    }
  }
);

/* =========================================================
   MPTS - INSPEÇÃO
========================================================= */

app.get(
  '/api/mpts/inspect/:id',
  async (req, res) => {

    try {

      await ensureLibrary();

      const item =
        findItem(
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

      const result =
        await inspectMPTS(item);

      res.json(result);

    } catch (error) {

      console.error(
        'MPTS INSPECT:',
        error
      );

      res
        .status(502)
        .json({

          error:
            'Não foi possível analisar o stream.',

          detail:
            error.message
        });
    }
  }
);

/* =========================================================
   MPTS - STREAM
========================================================= */

app.get(
  '/api/mpts/stream/:id',
  async (req, res) => {

    try {

      await ensureLibrary();

      const item =
        findItem(
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

      let program = null;

      if (
        req.query.program !==
        undefined
      ) {

        program =
          Number(
            req.query.program
          );

        if (
          !Number.isInteger(
            program
          )
        ) {

          return res
            .status(400)
            .json({

              error:
                'Número do programa inválido.'
            });
        }
      }

      await streamMPTS(
        item,
        program,
        res
      );

    } catch (error) {

      console.error(
        'MPTS STREAM:',
        error
      );

      if (
        !res.headersSent
      ) {

        res
          .status(502)
          .json({

            error:
              'Não foi possível iniciar o MPTS.',

            detail:
              error.message
          });

      } else if (
        !res.destroyed
      ) {

        res.end();
      }
    }
  }
);

/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `GC PLAY PRO backend 1.3.1`
    );

    console.log(
      `Porta: ${PORT}`
    );

    console.log(
      'MPTS: ATIVO'
    );
  }
);
