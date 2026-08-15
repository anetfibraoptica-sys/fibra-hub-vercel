const path = require('path');
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const crypto = require("crypto");

const net = require("net");

function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) return Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  if (len < 0x200000) return Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  if (len < 0x10000000) return Buffer.from([(len >> 24) | 0xe0, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  return Buffer.from([0xf0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

function decodeLength(buffer, offset) {
  const first = buffer[offset];
  if ((first & 0x80) === 0x00) return { len: first, size: 1 };
  if ((first & 0xc0) === 0x80) return { len: ((first & ~0xc0) << 8) + buffer[offset + 1], size: 2 };
  if ((first & 0xe0) === 0xc0) return { len: ((first & ~0xe0) << 16) + (buffer[offset + 1] << 8) + buffer[offset + 2], size: 3 };
  if ((first & 0xf0) === 0xe0) return { len: ((first & ~0xf0) << 24) + (buffer[offset + 1] << 16) + (buffer[offset + 2] << 8) + buffer[offset + 3], size: 4 };
  return { len: (buffer[offset + 1] << 24) + (buffer[offset + 2] << 16) + (buffer[offset + 3] << 8) + buffer[offset + 4], size: 5 };
}

function encodeWord(word) {
  const data = Buffer.from(String(word), "utf8");
  return Buffer.concat([encodeLength(data.length), data]);
}

function encodeSentence(words) {
  const parts = words.map(encodeWord);
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function parseSentences(buffer) {
  let offset = 0;
  const sentences = [];
  let current = [];

  while (offset < buffer.length) {
    const { len, size } = decodeLength(buffer, offset);
    offset += size;

    if (len === 0) {
      sentences.push(current);
      current = [];
      continue;
    }

    if (offset + len > buffer.length) break;
    current.push(buffer.slice(offset, offset + len).toString("utf8"));
    offset += len;
  }

  return sentences;
}

function routerosSend(host, port, user, pass, sentences, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let chunks = [];
    let finished = false;

    const finish = (err, result) => {
      if (finished) return;
      finished = true;
      try { socket.destroy(); } catch (_) {}
      if (err) reject(err);
      else resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(new Error("Timeout conectando na API MikroTik")));
    socket.on("error", err => finish(err));
    socket.on("data", chunk => chunks.push(chunk));

    socket.connect(Number(port || 8728), host, () => {
      socket.write(encodeSentence(["/login", `=name=${user}`, `=password=${pass}`]));

      setTimeout(() => {
        const loginResp = parseSentences(Buffer.concat(chunks)).flat().join(" ");
        if (loginResp.includes("!trap") || loginResp.toLowerCase().includes("invalid")) {
          return finish(new Error("Falha no login da API MikroTik"));
        }

        chunks = [];
        for (const words of sentences) {
          socket.write(encodeSentence(words));
        }
        socket.write(encodeSentence(["/quit"]));

        setTimeout(() => {
          const resp = parseSentences(Buffer.concat(chunks));
          const flat = resp.flat().join(" ");
          if (flat.includes("!trap")) {
            return finish(new Error("Erro retornado pelo MikroTik: " + flat));
          }
          finish(null, resp);
        }, 1200);
      }, 800);
    });
  });
}



/**
 * Executa um único comando na API do RouterOS aguardando a resposta real
 * (!done, !trap ou !fatal), sem temporizadores fixos. Esta função é usada
 * somente pelo diagnóstico do botão de acesso remoto.
 */
function routerosCommandStable(cfg, words, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let stage = "login";
    let buffer = Buffer.alloc(0);
    let finished = false;

    const finish = (error, sentences) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (_) {}
      if (error) reject(error);
      else resolve(sentences || []);
    };

    const timer = setTimeout(() => {
      finish(new Error("Timeout aguardando resposta da API MikroTik"));
    }, timeoutMs);

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(new Error("Timeout conectando na API MikroTik")));
    socket.on("error", (error) => finish(error));

    socket.on("data", (chunk) => {
      if (finished) return;
      buffer = Buffer.concat([buffer, chunk]);
      const sentences = parseSentences(buffer);
      if (!sentences.length) return;

      if (stage === "login") {
        const loginTrap = sentences.find((sentence) => sentence.includes("!trap") || sentence.includes("!fatal"));
        if (loginTrap) {
          return finish(new Error("Falha no login da API MikroTik: " + loginTrap.join(" ")));
        }

        const loginDone = sentences.some((sentence) => sentence.includes("!done"));
        if (!loginDone) return;

        stage = "command";
        buffer = Buffer.alloc(0);
        socket.write(encodeSentence(words));
        return;
      }

      const terminou = sentences.some((sentence) =>
        sentence.includes("!done") || sentence.includes("!trap") || sentence.includes("!fatal")
      );
      if (terminou) finish(null, sentences);
    });

    socket.connect(Number(cfg.port || 8728), cfg.host, () => {
      socket.write(encodeSentence(["/login", `=name=${cfg.user}`, `=password=${cfg.pass}`]));
    });
  });
}

function routerosResponseText(sentences) {
  return (sentences || []).flat().join(" ");
}

function routerosField(sentences, fieldName) {
  const prefix = `=${fieldName}=`;
  for (const sentence of sentences || []) {
    for (const word of sentence || []) {
      if (word.startsWith(prefix)) return word.slice(prefix.length);
    }
  }
  return "";
}

/**
 * Reproduz pelo MikroTik o teste manual confirmado no WinBox:
 * /tool fetch url="http://IP:PORTA" output=none
 */
async function testarAcessoWebPeloMikroTik(cfg, url) {
  const sentences = await routerosCommandStable(cfg, [
    "/tool/fetch",
    `=url=${url}`,
    "=output=none",
    // Pela API, as-value faz o RouterOS devolver status/downloaded/total.
    // Sem isso o comando pode terminar apenas com !done e o painel não
    // consegue identificar qual porta respondeu.
    "=as-value=",
    "=idle-timeout=3s",
    "=http-max-redirect-count=0",
    "=check-certificate=no"
  ], 8000);

  const texto = routerosResponseText(sentences);
  const status = routerosField(sentences, "status").toLowerCase();
  const downloaded = routerosField(sentences, "downloaded");
  const total = routerosField(sentences, "total");
  const trapMessage = routerosField(sentences, "message");
  const temTrap = sentences.some((sentence) => sentence.includes("!trap") || sentence.includes("!fatal"));
  const terminou = sentences.some((sentence) => sentence.includes("!done"));

  // Sucesso normal do RouterOS: status=finished, com ou sem tamanho baixado.
  if (status === "finished") {
    return { ok: true, status, downloaded, total, texto };
  }

  // Algumas versões do RouterOS confirmam o fetch apenas com !done.
  // Como falhas de conexão chegam como !trap, !done sem trap também
  // confirma que a porta respondeu.
  if (terminou && !temTrap) {
    return { ok: true, status: status || "finished", downloaded, total, texto };
  }

  // Redirecionamento, autenticação ou outra resposta HTTP comprovam que
  // existe um servidor web escutando naquela porta.
  const httpStatus = String(trapMessage || texto).match(/(?:status|HTTP\/\d(?:\.\d)?)\D+(\d{3})/i);
  if (httpStatus) {
    const code = Number(httpStatus[1]);
    if (code >= 200 && code < 600) {
      return { ok: true, status: String(code), downloaded, total, texto };
    }
  }

  if (/Location:|login\.html|status\s*(?:301|302|303|307|308|401|403)/i.test(trapMessage + " " + texto)) {
    return { ok: true, status: "http-response", downloaded, total, texto };
  }

  return { ok: false, status, downloaded, total, texto, erro: trapMessage };
}

function servidorConfig(nomeServidor) {
  const nome = String(nomeServidor || "").toUpperCase();

  const pick = (...keys) => {
    for (const k of keys) {
      if (process.env[k] !== undefined && String(process.env[k]).trim() !== "") return String(process.env[k]).trim();
    }
    return "";
  };

  const pickPort = (...keys) => pick(...keys) || 8728;

  if (nome.includes("ARMANDO") || nome.includes("ZUMBI")) {
    return {
      key: "armando",
      host: pick("MIKROTIK_ARMANDO_HOST", "MK_ARMANDO_HOST", "ARMANDO_HOST", "MIKROTIK_HOST_ARMANDO", "MIKROTIK1_HOST"),
      port: pickPort("MIKROTIK_ARMANDO_PORT", "MK_ARMANDO_PORT", "ARMANDO_PORT", "MIKROTIK_PORT_ARMANDO", "MIKROTIK1_PORT"),
      user: pick("MIKROTIK_ARMANDO_USER", "MK_ARMANDO_USER", "ARMANDO_USER", "MIKROTIK_USER_ARMANDO", "MIKROTIK1_USER"),
      pass: pick("MIKROTIK_ARMANDO_PASS", "MIKROTIK_ARMANDO_PASSWORD", "MK_ARMANDO_PASS", "ARMANDO_PASS", "MIKROTIK_PASS_ARMANDO", "MIKROTIK1_PASS")
    };
  }

  return {
    key: "colonia",
    host: pick("MIKROTIK_COLONIA_HOST", "MK_COLONIA_HOST", "COLONIA_HOST", "MIKROTIK_HOST_COLONIA", "MIKROTIK2_HOST"),
    port: pickPort("MIKROTIK_COLONIA_PORT", "MK_COLONIA_PORT", "COLONIA_PORT", "MIKROTIK_PORT_COLONIA", "MIKROTIK2_PORT"),
    user: pick("MIKROTIK_COLONIA_USER", "MK_COLONIA_USER", "COLONIA_USER", "MIKROTIK_USER_COLONIA", "MIKROTIK2_USER"),
    pass: pick("MIKROTIK_COLONIA_PASS", "MIKROTIK_COLONIA_PASSWORD", "MK_COLONIA_PASS", "COLONIA_PASS", "MIKROTIK_PASS_COLONIA", "MIKROTIK2_PASS")
  };
}


function servidorConfigClientesColonia() {
  const pick = (...keys) => {
    for (const k of keys) {
      if (process.env[k] !== undefined && String(process.env[k]).trim() !== "") return String(process.env[k]).trim();
    }
    return "";
  };

  /*
   * IMPORTANTE - topologia Colonia:
   * O endpoint legado MIKROTIK_COLONIA_*:8728 já é o caminho funcional do painel
   * e, na rede, é encaminhado pela RB3011 para a API da RB4011.
   * Portanto os clientes PPPoE devem PRIORIZAR esse caminho conhecido.
   * As variáveis *_CLIENTES_* ficam apenas como fallback para instalações que
   * tenham um endpoint direto e realmente alcançável para a RB4011.
   */
  return {
    key: "colonia",
    host: pick(
      "MIKROTIK_COLONIA_HOST", "MK_COLONIA_HOST", "COLONIA_HOST", "MIKROTIK_HOST_COLONIA", "MIKROTIK2_HOST",
      "MIKROTIK_COLONIA_CLIENTES_HOST", "RB4011_HOST"
    ),
    port: pick(
      "MIKROTIK_COLONIA_PORT", "MK_COLONIA_PORT", "COLONIA_PORT", "MIKROTIK_PORT_COLONIA", "MIKROTIK2_PORT",
      "MIKROTIK_COLONIA_CLIENTES_PORT", "RB4011_PORT"
    ) || 8728,
    user: pick(
      "MIKROTIK_COLONIA_USER", "MK_COLONIA_USER", "COLONIA_USER", "MIKROTIK_USER_COLONIA", "MIKROTIK2_USER",
      "MIKROTIK_COLONIA_CLIENTES_USER", "RB4011_USER"
    ),
    pass: pick(
      "MIKROTIK_COLONIA_PASS", "MIKROTIK_COLONIA_PASSWORD", "MK_COLONIA_PASS", "COLONIA_PASS", "MIKROTIK_PASS_COLONIA", "MIKROTIK2_PASS",
      "MIKROTIK_COLONIA_CLIENTES_PASS", "RB4011_PASS"
    )
  };
}

function servidorConfigLinksColonia() {
  const pick = (...keys) => {
    for (const k of keys) {
      if (process.env[k] !== undefined && String(process.env[k]).trim() !== "") return String(process.env[k]).trim();
    }
    return "";
  };

  const base = servidorConfig("colonia");
  return {
    key: "colonia-links",
    // Mesmo endpoint/tunel do painel, mas em uma porta separada que deve terminar
    // LOCALMENTE na API 8728 da RB3011 (sem cair no CUTOVER para a RB4011).
    host: pick("MIKROTIK_COLONIA_LINKS_HOST", "RB3011_LINKS_HOST") || base.host,
    port: pick("MIKROTIK_COLONIA_LINKS_PORT", "RB3011_LINKS_PORT") || 8730,
    user: pick("MIKROTIK_COLONIA_LINKS_USER", "RB3011_LINKS_USER") || base.user,
    pass: pick("MIKROTIK_COLONIA_LINKS_PASS", "MIKROTIK_COLONIA_LINKS_PASSWORD", "RB3011_LINKS_PASS") || base.pass
  };
}

function servidorConfigLinks(nomeServidor) {
  return fibraServidorEhColonia(nomeServidor) ? servidorConfigLinksColonia() : servidorConfig(nomeServidor);
}

function servidorConfigClientes(nomeServidor) {
  const nome = String(nomeServidor || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const ehColonia = nome === "colonia" ||
    nome.includes("colonia antonio aleixo") ||
    nome.includes("antonio aleixo");

  return ehColonia ? servidorConfigClientesColonia() : servidorConfig(nomeServidor);
}

function diagnosticoConfigServidor(nomeServidor) {
  const cfg = servidorConfig(nomeServidor);
  return {
    key: cfg.key,
    hostConfigurado: Boolean(cfg.host),
    hostPreview: cfg.host ? String(cfg.host).replace(/(.{4}).+(.{3})$/, "$1***$2") : "",
    port: cfg.port || 8728,
    userConfigurado: Boolean(cfg.user),
    userPreview: cfg.user ? String(cfg.user).slice(0, 2) + "***" : "",
    passConfigurado: Boolean(cfg.pass)
  };
}



function montarComentarioClienteMikrotik(cliente = {}) {
  const nome = String(cliente.nome || cliente.cadNome || cliente.razaoSocial || "").trim();
  const cpf = fbFormatarCpf(
    cliente.cpf || cliente.cpfCnpj || cliente.cpf_cnpj || cliente.cadCpf || ""
  );
  const login = String(cliente.login || cliente.loginPppoe || cliente.pppoe || cliente.usuario || "").trim();

  if (nome && cpf) return `${nome}: ${cpf}`;
  return nome || cpf || login;
}

async function criarPPPoECliente(cliente) {
  const cfg = servidorConfigClientes(servidorCliente(cliente));
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas no Render para " + cfg.key);
  }

  const usuario = cliente.pppoe || cliente.usuario || "";
  const senha = cliente.senha || "";
  const plano = cliente.plano || "default";

  if (!usuario || !senha) {
    throw new Error("Usuário PPPoE ou senha não informado.");
  }

  const comentario = montarComentarioClienteMikrotik(cliente);

  const words = [
    "/ppp/secret/add",
    `=name=${usuario}`,
    `=password=${senha}`,
    "=service=pppoe",
    `=profile=${plano}`,
    `=comment=${comentario}`
  ];

  return routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [words]);
}


const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const TOKEN = process.env.PANEL_TOKEN || "fibra2026";
const SESSION_SECRET = String(process.env.SESSION_SECRET || process.env.CRON_SECRET || "").trim();
const SESSION_COOKIE = "fibrahub_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > 0) out[decodeURIComponent(part.slice(0, i).trim())] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signSession(payload) {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET não configurado na Vercel.");
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readSession(req) {
  try {
    if (!SESSION_SECRET) return null;
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token || !token.includes(".")) return null;
    const [body, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() >= payload.exp * 1000) return null;
    return payload;
  } catch (_) { return null; }
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
}

function requireSession(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ ok:false, erro:"Sessão inválida ou expirada." });
  req.sessionUser = session;
  next();
}

function hasPermission(user, permission) {
  if (!permission) return true;
  if (user && (user.super_admin || String(user.funcao || "").toLowerCase().includes("superadmin"))) return true;
  return Boolean(user && user.permissoes && user.permissoes[permission]);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.sessionUser, permission)) return res.status(403).json({ ok:false, erro:"Usuário sem permissão para esta ação." });
    next();
  };
}

const PUBLIC_PAGES = new Set(["/", "/index.html", "/login.html", "/favicon.svg", "/style.css", "/00-fix-definitivo.js", "/supabase-client.js", "/auth-painel.js"]);
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/") || req.path.startsWith("/socket.io/") || req.path.startsWith("/remoto/")) return next();
  // A Central do Assinante possui uma sessão própria, separada do painel administrativo.
  if (req.path === "/central" || req.path.startsWith("/central/")) return next();
  if (PUBLIC_PAGES.has(req.path)) return next();
  if (/\.(html)$/i.test(req.path) && !readSession(req)) return res.redirect("/login.html");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.use("/api", (req, res, next) => {
  const publicApi = req.path.startsWith("/auth/") || req.path.startsWith("/central/") || req.path === "/status" || req.path === "/login-teste" || req.path === "/login" || req.path.startsWith("/efi/webhook") || req.path.startsWith("/cron/") || req.path === "/update" || req.path === "/mikrotik/cliente-acao";
  if (publicApi) return next();
  return requireSession(req, res, next);
});

app.use("/api", (req,res,next) => {
  if (!req.sessionUser) return next();
  let permission = null;
  if (req.method === "DELETE") permission = "excluir";
  else if (req.path === "/boletos/baixa-manual") permission = "baixa";
  else if (req.path.startsWith("/efi/salvar-config") || req.path.startsWith("/efi/testar-conexao")) permission = "configuracoes";
  else if (req.path.startsWith("/mikrotik/") || /\/(bloquear|desbloquear|confianca)$/.test(req.path)) permission = "mikrotik";
  else if (req.method !== "GET" && req.path.startsWith("/clientes")) permission = "cadastro";
  if (permission && !hasPermission(req.sessionUser, permission)) return res.status(403).json({ok:false,erro:"Usuário sem permissão para esta ação."});
  next();
});
// A Central e o painel usam a mesma conexão PostgreSQL do projeto Supabase.
// DATABASE_URL continua sendo o nome principal; os aliases facilitam deploys já configurados.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL || "";
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

let servidores = {
  colonia: {
    servidor: "colonia",
    nome: "COLÔNIA ANTÔNIO ALEIXO",
    online: false,
    atualizadoEm: null,
    identity: "COLÔNIA ANTÔNIO ALEIXO",
    cpu: "0",
    uptime: "--",
    pppoeOnline: 0,
    download: "0 Mbps",
    upload: "0 Mbps",
    interfaces: [],
    clientes: []
  },
  armando: {
    servidor: "armando",
    nome: "ARMANDO MENDES",
    online: false,
    atualizadoEm: null,
    identity: "ARMANDO MENDES",
    cpu: "0",
    uptime: "--",
    pppoeOnline: 0,
    download: "0 Mbps",
    upload: "0 Mbps",
    interfaces: [],
    clientes: []
  }
};

function n(v) {
  if (!v) return 0;
  return Number(String(v).replace("Mbps","").replace("Mb","").replace(",",".").trim()) || 0;
}

function geral() {
  const lista = Object.values(servidores);
  const clientes = lista.flatMap(s => (s.clientes || []).map(c => ({ ...c, servidor: s.nome })));
  return {
    atualizadoEm: new Date().toISOString(),
    servidores,
    totalServidores: lista.length,
    servidoresOnline: lista.filter(s => s.online).length,
    pppoeOnline: lista.reduce((a,s)=>a+Number(s.pppoeOnline || 0),0),
    download: lista.reduce((a,s)=>a+n(s.download),0).toFixed(1) + " Mbps",
    upload: lista.reduce((a,s)=>a+n(s.upload),0).toFixed(1) + " Mbps",
    cpuMedia: Math.round(lista.reduce((a,s)=>a+Number(s.cpu || 0),0) / lista.length),
    clientes
  };
}

async function initDb() {
  if (!process.env.DATABASE_URL) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      servidor TEXT,
      cpf TEXT,
      telefone TEXT,
      cep TEXT,
      endereco TEXT,
      numero TEXT,
      complemento TEXT,
      referencia TEXT,
      bairro TEXT,
      plano TEXT,
      pppoe TEXT,
      acesso_remoto TEXT,
      senha TEXT,
      vencimento TEXT,
      valor TEXT,
      status TEXT DEFAULT 'ativo',
      confianca_ate TEXT,
      observacoes TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cep TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS numero TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS complemento TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS referencia TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS servidor TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS acesso_remoto TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS confianca_ate TEXT;");
  await pool.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS plano_cobranca_id INTEGER;");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS efi_configuracoes (
      conta INTEGER PRIMARY KEY,
      nome_conta TEXT,
      documento TEXT,
      ambiente TEXT DEFAULT 'producao',
      client_id TEXT,
      client_secret TEXT,
      webhook TEXT,
      ativo BOOLEAN DEFAULT TRUE,
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS efi_boletos_vinculos (
      id SERIAL PRIMARY KEY,
      boleto_origem TEXT,
      cliente_nome TEXT,
      cliente_documento TEXT,
      valor TEXT,
      vencimento TEXT,
      conta INTEGER DEFAULT 1,
      charge_id TEXT,
      txid TEXT,
      situacao_efi TEXT,
      linha_digitavel TEXT,
      pix_copia_cola TEXT,
      link_boleto TEXT,
      raw JSONB,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query("ALTER TABLE efi_boletos_vinculos ADD COLUMN IF NOT EXISTS efi_charge_id TEXT;");
  await pool.query("ALTER TABLE efi_boletos_vinculos ADD COLUMN IF NOT EXISTS efi_carne_id TEXT;");
  await pool.query("ALTER TABLE efi_boletos_vinculos ADD COLUMN IF NOT EXISTS identificacao_receitanet TEXT;");


  
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_charge_id TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_status TEXT;");
  // efi_conta_id pode existir como UUID no Supabase; não alteramos nem gravamos número 1 nele.
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_conta_nome TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS linha_digitavel TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS pix TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS link_pdf TEXT;");

  console.log("PostgreSQL conectado.");
}


function rateLimitPorPlano(plano) {
  const p = String(plano || "").toLowerCase();
  const match = p.match(/(\d+)/);
  if (!match) return "";
  let numero = Number(match[1]);
  if (p.includes("giga") || p.includes("1g")) numero = 1000;
  if (!numero) return "";
  return `${numero}M/${numero}M`;
}

async function criarPPPoEClienteComProfile(cliente) {
  const cfg = servidorConfigClientes(servidorCliente(cliente));
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas no Render para " + cfg.key);
  }

  const usuario = cliente.pppoe || cliente.usuario || "";
  const senha = cliente.senha || "";
  const plano = cliente.plano || "default";

  if (!usuario || !senha) {
    throw new Error("Usuário PPPoE ou senha não informado.");
  }

  const rateLimit = rateLimitPorPlano(plano);
  const comentario = montarComentarioClienteMikrotik(cliente);

  // 1) Primeiro tenta criar o profile/plano.
  // Se já existir, ignora e continua.
  if (plano && plano !== "default") {
    const profileWords = [
      "/ppp/profile/add",
      `=name=${plano}`
    ];

    if (rateLimit) profileWords.push(`=rate-limit=${rateLimit}`);

    try {
      await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [profileWords]);
    } catch (e) {
      const msg = String(e.message || "").toLowerCase();
      const jaExiste = msg.includes("already exists") || msg.includes("already have") || msg.includes("same name");
      if (!jaExiste) {
        throw e;
      }
      console.log("Profile já existe no MikroTik, continuando:", plano);
    }
  }

  // 2) Depois cria o PPP Secret.
  // Se o cliente já existir, retorna erro claro.
  const secretWords = [
    "/ppp/secret/add",
    `=name=${usuario}`,
    `=password=${senha}`,
    "=service=pppoe",
    `=profile=${plano}`,
    `=comment=${comentario}`
  ];

  return routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [secretWords]);
}



function parseRouterosRows(sentences) {
  const rows = [];
  for (const sentence of sentences || []) {
    if (!Array.isArray(sentence)) continue;
    if (!sentence.includes("!re")) continue;
    const row = {};
    for (const word of sentence) {
      if (word.startsWith("=")) {
        const idx = word.indexOf("=", 1);
        if (idx > 0) {
          const key = word.slice(1, idx);
          const value = word.slice(idx + 1);
          row[key] = value;
        }
      }
    }
    rows.push(row);
  }
  return rows;
}


async function consultarStatusMikroTik(cliente) {
  const cfg = servidorConfigClientes(servidorCliente(cliente));
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + cfg.key);
  }

  const usuario = loginPPPoECliente(cliente);
  if (!usuario) {
    return { status: "nao_provisionado", texto: "⚫ Não provisionado", detalhe: "Cliente sem usuário PPPoE." };
  }

  const activeResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ppp/active/print",
    `?name=${usuario}`
  ]]);

  const secretResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ppp/secret/print",
    `?name=${usuario}`
  ]]);

  const activeRows = parseRouterosRows(activeResp);
  const secretRows = parseRouterosRows(secretResp);

  const active = activeRows[0];
  const secret = secretRows[0];

  const agora = new Date();
  const confiancaAte = cliente.confianca_ate ? new Date(cliente.confianca_ate) : null;

  if (!secret) {
    return {
      status: "nao_provisionado",
      texto: "⚫ Não provisionado",
      detalhe: "PPP Secret não encontrado no MikroTik.",
      pppoe: usuario
    };
  }

  if (secret.disabled === "true" || secret.disabled === "yes") {
    if (confiancaAte && confiancaAte > agora) {
      return {
        status: "confianca",
        texto: "⭐ Em confiança",
        detalhe: "Cliente está em confiança.",
        confianca_ate: cliente.confianca_ate,
        pppoe: usuario,
        ip: active ? active.address : "",
        uptime: active ? active.uptime : ""
      };
    }

    return {
      status: "bloqueado",
      texto: "🟡 Bloqueado",
      detalhe: "PPP Secret desativado no MikroTik.",
      pppoe: usuario
    };
  }

  if (confiancaAte && confiancaAte > agora) {
    return {
      status: "confianca",
      texto: "⭐ Em confiança",
      detalhe: "Liberado em confiança.",
      confianca_ate: cliente.confianca_ate,
      pppoe: usuario,
      ip: active ? active.address : "",
      uptime: active ? active.uptime : "",
      caller_id: active ? active["caller-id"] : ""
    };
  }

  if (active) {
    return {
      status: "online",
      texto: "🟢 Online",
      detalhe: "Cliente conectado no PPPoE.",
      pppoe: usuario,
      ip: active.address || "",
      uptime: active.uptime || "",
      caller_id: active["caller-id"] || "",
      service: active.service || ""
    };
  }

  return {
    status: "offline",
    texto: "🔴 Offline",
    detalhe: "PPP Secret existe, mas o cliente não está conectado.",
    pppoe: usuario
  };
}


app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));




app.get("/api/login-teste", (req, res) => {
  res.json({ ok: true, login: "autenticação segura por cookie ativa", sessionSecretConfigurado: Boolean(SESSION_SECRET) });
});

app.post("/api/auth/login", async (req, res) => {
  try {
    if (!SESSION_SECRET) return res.status(503).json({ ok:false, erro:"SESSION_SECRET não configurado na Vercel." });
    const usuario = String(req.body?.usuario || "").trim().toLowerCase();
    const senha = String(req.body?.senha || "");
    if (!usuario || !senha) return res.status(400).json({ ok:false, erro:"Informe usuário e senha." });
    const senhaHash = crypto.createHash("sha256").update(senha, "utf8").digest("hex");
    const r = await pool.query(`SELECT id,nome,usuario,senha_hash,funcao,status,permissoes,COALESCE(super_admin,false) super_admin FROM public.usuarios_painel WHERE lower(usuario)=lower($1) LIMIT 1`, [usuario]);
    const row = r.rows[0];
    if (!row || String(row.status || "").toLowerCase() !== "ativo") return res.status(401).json({ ok:false, erro:"Usuário ou senha inválidos." });
    const a = Buffer.from(String(row.senha_hash || "")); const b = Buffer.from(senhaHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return res.status(401).json({ ok:false, erro:"Usuário ou senha inválidos." });
    const now = Math.floor(Date.now()/1000);
    const usuarioSeguro = { id:row.id, nome:row.nome, usuario:row.usuario, funcao:row.funcao, permissoes:row.permissoes || {}, super_admin:Boolean(row.super_admin) };
    setSessionCookie(res, signSession({ ...usuarioSeguro, iat:now, exp:now+SESSION_TTL_SECONDS }));
    await pool.query("UPDATE public.usuarios_painel SET ultimo_acesso=now() WHERE id=$1", [row.id]).catch(()=>{});
    await pool.query(`INSERT INTO public.auditoria_painel(usuario_id,usuario_nome,usuario_login,acao,entidade,entidade_id,dados) VALUES($1,$2,$3,'login','usuarios_painel',$4,$5::jsonb)`, [row.id,row.nome,row.usuario,String(row.id),JSON.stringify({ip:req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""})]).catch(()=>{});
    res.json({ ok:true, usuario:usuarioSeguro });
  } catch (error) { res.status(500).json({ ok:false, erro:error.message }); }
});

app.get("/api/auth/me", requireSession, (req,res) => res.json({ok:true, usuario:req.sessionUser}));
app.post("/api/auth/logout", (req,res) => { clearSessionCookie(res); res.json({ok:true}); });

// Compatibilidade: o login antigo agora também cria a sessão segura.
app.post("/api/login", async (req,res,next) => {
  req.url = "/api/auth/login";
  next();
});

app.get("/api/usuarios-painel", requireSession, requirePermission("usuarios"), async (req,res) => {
  try {
    const r = await pool.query(`SELECT id,nome,usuario,funcao,status,permissoes,COALESCE(super_admin,false) super_admin,ultimo_acesso,criado_em,atualizado_em FROM public.usuarios_painel ORDER BY nome`);
    res.json({ok:true, usuarios:r.rows});
  } catch(e) { res.status(500).json({ok:false, erro:e.message}); }
});

app.post("/api/auditoria-painel", requireSession, async (req,res) => {
  try {
    const d=req.body?.dados||{};
    await pool.query(`INSERT INTO public.auditoria_painel(usuario_id,usuario_nome,usuario_login,acao,entidade,entidade_id,cliente_login,cliente_nome,valor,dados) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [req.sessionUser.id||null,req.sessionUser.nome||null,req.sessionUser.usuario||null,String(req.body?.acao||""),String(req.body?.entidade||""),String(req.body?.entidade_id||""),d.cliente_login||d.login||null,d.cliente_nome||d.nome||null,d.valor!==undefined?Number(d.valor||0):null,JSON.stringify(d)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({ok:false,erro:e.message}); }
});

app.post("/api/usuarios-painel", requireSession, requirePermission("usuarios"), async (req,res) => {
  try {
    const nome=String(req.body?.nome||"").trim(), usuario=String(req.body?.usuario||"").trim().toLowerCase(), senha=String(req.body?.senha||""), funcao=String(req.body?.funcao||"Atendimento"), status=String(req.body?.status||"ativo").toLowerCase();
    if(!nome || !usuario) return res.status(400).json({ok:false,erro:"Nome e usuário são obrigatórios."});
    if(senha && senha.length<4) return res.status(400).json({ok:false,erro:"A senha precisa ter pelo menos 4 caracteres."});
    const permissoes=req.body?.permissoes||{};
    const hash=senha ? crypto.createHash("sha256").update(senha,"utf8").digest("hex") : null;
    const q=hash ? `INSERT INTO public.usuarios_painel(nome,usuario,senha_hash,funcao,status,permissoes,atualizado_em) VALUES($1,$2,$3,$4,$5,$6::jsonb,now()) ON CONFLICT(usuario) DO UPDATE SET nome=excluded.nome,senha_hash=excluded.senha_hash,funcao=excluded.funcao,status=excluded.status,permissoes=excluded.permissoes,atualizado_em=now() RETURNING id,nome,usuario,funcao,status,permissoes` : `UPDATE public.usuarios_painel SET nome=$1,funcao=$4,status=$5,permissoes=$6::jsonb,atualizado_em=now() WHERE usuario=$2 RETURNING id,nome,usuario,funcao,status,permissoes`;
    const r=await pool.query(q,[nome,usuario,hash,funcao,status,JSON.stringify(permissoes)]);
    if(!r.rows[0]) return res.status(400).json({ok:false,erro:"Para criar um usuário novo, informe uma senha."});
    res.json({ok:true,usuario:r.rows[0]});
  } catch(e) { res.status(500).json({ok:false,erro:e.message}); }
});


/* ============================================================
   CENTRAL DO ASSINANTE
   - Usa o mesmo PostgreSQL/Supabase do Fibra+ Hub.
   - Sessão própria por cookie HttpOnly.
   - Um acesso por CPF pode reunir vários pontos/contratos.
============================================================ */
const CENTRAL_SESSION_COOKIE = "fibra_assinante_session";
const CENTRAL_SESSION_TTL_SECONDS = 12 * 60 * 60;
const CENTRAL_SESSION_REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60;

function centralOnlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function centralValidCpf(value) {
  const cpf = centralOnlyDigits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
}

function centralMaskDocument(value) {
  const doc = centralOnlyDigits(value);
  if (doc.length === 11) return `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**`;
  return "";
}

function centralSignSession(payload) {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET não configurado.");
  const body = base64url(JSON.stringify({...payload, aud:"central-assinante"}));
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function centralReadSession(req) {
  try {
    if (!SESSION_SECRET) return null;
    const token = parseCookies(req)[CENTRAL_SESSION_COOKIE];
    if (!token || !token.includes(".")) return null;
    const [body, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.aud !== "central-assinante" || !payload.exp || Date.now() >= payload.exp * 1000) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function centralSetSessionCookie(res, token, maxAge) {
  const secure = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  res.setHeader("Set-Cookie", `${CENTRAL_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
}

function centralClearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  res.setHeader("Set-Cookie", `${CENTRAL_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
}

function requireCentralSession(req, res, next) {
  const session = centralReadSession(req);
  if (!session) return res.status(401).json({ok:false, erro:"Sessão do assinante inválida ou expirada."});
  req.centralSession = session;
  next();
}

async function centralEnsureTables() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
  await fbEnsureTables();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_assinantes (
      id BIGSERIAL PRIMARY KEY,
      documento TEXT NOT NULL UNIQUE,
      senha_hash TEXT,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      cliente_principal_id TEXT,
      tentativas_falhas INTEGER NOT NULL DEFAULT 0,
      bloqueado_ate TIMESTAMPTZ,
      ultimo_acesso TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const alters = [
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefone1 TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefone2 TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS endereco TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS bairro TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cidade TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS uf TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cep TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS valor_mensal NUMERIC DEFAULT 0;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dia_vencimento INTEGER;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ativo';"
  ];
  for (const sql of alters) await pool.query(sql);
  await pool.query("ALTER TABLE central_assinantes ALTER COLUMN senha_hash DROP NOT NULL;");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_central_assinantes_documento ON central_assinantes(documento);");
}

function centralDados(row) {
  const raw = row && row.dados && typeof row.dados === "object" ? row.dados : {};
  const nested = raw && raw.dados && typeof raw.dados === "object" ? raw.dados : {};
  return {...nested, ...raw};
}

function centralPick(objects, keys, fallback="") {
  for (const object of objects) {
    if (!object) continue;
    for (const key of keys) {
      const value = object[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
  }
  return fallback;
}

function centralNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value ?? "").trim().replace(/[R$\s]/g, "");
  if (text.includes(",") && text.includes(".")) text = text.replace(/\./g, "").replace(",", ".");
  else if (text.includes(",")) text = text.replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function centralClientPublic(row) {
  const data = centralDados(row);
  const document = centralOnlyDigits(centralPick([row, data], ["cpf_cnpj","cpfCnpj","cpf","cnpj","documento","cadCpf"]));
  return {
    id: String(row.id),
    nome: String(centralPick([row, data], ["nome","cliente","razaoSocial","razao_social"], "Assinante")),
    documento: centralMaskDocument(document),
    loginPppoe: String(centralPick([row, data], ["login_pppoe","loginPppoe","login","usuario","pppoe"])),
    plano: String(centralPick([row, data], ["plano","planoCobranca","plano_cobranca","profile","perfil"], "Plano não informado")),
    profile: String(centralPick([row, data], ["profile","perfil"])),
    valorMensal: centralNumber(centralPick([row, data], ["valor_mensal","valorMensal","mensalidade","valorPlano","valor","valor_plano","valorPlanoCobranca"])),
    diaVencimento: Number(centralPick([row, data], ["dia_vencimento","diaVencimento","vencimento"], 0)) || null,
    status: String(centralPick([row, data], ["status","situacao","statusCliente","status_cliente"], "ativo")),
    telefone1: String(centralPick([row, data], ["telefone1","telefone","celular","whatsapp","fone"])),
    telefone2: String(centralPick([row, data], ["telefone2","celular2","fone2"])),
    email: String(centralPick([row, data], ["email","e_mail","mail"])),
    dataNascimento: centralPick([row, data], ["cadNascimento","dataNascimento","data_nascimento","nascimento","dtNascimento","dt_nascimento"]),
    endereco: String(centralPick([row, data], ["endereco","logradouro","rua"])),
    bairro: String(centralPick([row, data], ["bairro"])),
    cidade: String(centralPick([row, data], ["cidade","municipio","localidade"])),
    uf: String(centralPick([row, data], ["uf","estado"])),
    cep: String(centralPick([row, data], ["cep"])),
    tecnologia: String(centralPick([row, data], ["tecnologia","tipoTecnologia","tipo_tecnologia"])),
    servidor: String(centralPick([row, data], ["servidor","popServidor","pop_servidor"])),
    atualizadoEm: row.atualizado_em || null
  };
}

function centralBillPublic(row) {
  const data = row && row.dados && typeof row.dados === "object" ? row.dados : {};
  return {
    id: String(row.id),
    numero: String(centralPick([row, data], ["numero","nossoNumero","titulo"], row.id)),
    descricao: String(centralPick([row, data], ["descricao","categoria"], "Mensalidade")),
    categoria: String(centralPick([row, data], ["categoria"], "Mensalidade")),
    emissao: centralPick([row, data], ["emissao"]),
    vencimento: centralPick([row, data], ["vencimento","dataVencimento","dueDate","expire_at"]),
    pagamento: centralPick([row, data], ["pagamento","dataPagamento"]),
    valor: centralNumber(centralPick([row, data], ["total","valor"], 0)),
    valorPago: centralNumber(centralPick([row, data], ["valor_pago","valorPago"], 0)),
    status: String(centralPick([row, data], ["status","efi_status","efiStatus"], "pendente")),
    linhaDigitavel: String(centralPick([row, data], ["linha_digitavel","linhaDigitavel"])),
    codigoBarras: String(centralPick([row, data], ["codigo_barras","codigoBarras"])),
    pix: String(centralPick([row, data], ["pix","codigoPix"])),
    linkPdf: String(centralPick([row, data], ["link_pdf","linkPdf","pdf","segundaVia"])),
    clienteId: String(centralPick([row, data], ["cliente_id","clienteId"])),
    clienteLogin: String(centralPick([row, data], ["cliente_login","clienteLogin","login","loginPppoe"]))
  };
}

async function centralClientsByDocument(document) {
  await centralEnsureTables();
  const result = await pool.query(`
    SELECT *
    FROM clientes
    WHERE regexp_replace(
      COALESCE(
        NULLIF(cpf_cnpj,''),
        NULLIF(dados->>'cpfCnpj',''),
        NULLIF(dados->>'cpf_cnpj',''),
        NULLIF(dados->>'cpf',''),
        NULLIF(dados->>'cnpj',''),
        NULLIF(dados->>'documento',''),
        NULLIF(dados->>'cadCpf',''),
        ''
      ),
      '[^0-9]','','g'
    )=$1
    ORDER BY atualizado_em DESC NULLS LAST, criado_em DESC NULLS LAST, id DESC
  `, [document]);
  return result.rows || [];
}

async function centralBillsForClients(document, clients) {
  await centralEnsureTables();
  const ids = clients.map(item => String(item.id)).filter(Boolean);
  const logins = clients.map(item => String(centralPick([item, centralDados(item)], ["login_pppoe","loginPppoe","login","usuario","pppoe"]))).filter(Boolean);
  const result = await pool.query(`
    SELECT *
    FROM boletos
    WHERE cliente_id = ANY($1::text[])
       OR cliente_login = ANY($2::text[])
       OR regexp_replace(COALESCE(cpf_cnpj, dados->>'cpfCnpj', dados->>'cpf', dados->>'cnpj', ''), '[^0-9]','','g')=$3
    ORDER BY vencimento DESC NULLS LAST, id DESC
    LIMIT 300
  `, [ids, logins, document]);
  return result.rows || [];
}

async function centralClientById(id) {
  await centralEnsureTables();
  const result = await pool.query("SELECT * FROM clientes WHERE id::text=$1 LIMIT 1", [String(id || "")]);
  return result.rows[0] || null;
}

function centralDocumentFromClient(client) {
  return centralOnlyDigits(centralPick([client, centralDados(client)], ["cpf_cnpj","cpfCnpj","cpf","cnpj","documento","cadCpf"]));
}

app.get("/api/central/status", async (_req, res) => {
  try {
    await centralEnsureTables();
    const check = await pool.query("SELECT to_regclass('public.clientes') AS clientes, to_regclass('public.boletos') AS boletos");
    res.json({
      ok:true,
      banco:"supabase-postgresql",
      conectado:true,
      tabelas:{
        clientes:Boolean(check.rows[0]?.clientes),
        boletos:Boolean(check.rows[0]?.boletos)
      },
      autenticacao:"cpf-cookie-http-only"
    });
  } catch (error) {
    res.status(503).json({ok:false, conectado:false, erro:error.message});
  }
});

app.post("/api/central/login", async (req, res) => {
  try {
    if (!SESSION_SECRET) return res.status(503).json({ok:false, erro:"SESSION_SECRET não configurado no servidor."});
    await centralEnsureTables();
    const documento = centralOnlyDigits(req.body?.cpf || req.body?.documento);
    const lembrar = Boolean(req.body?.lembrar);
    if (!centralValidCpf(documento)) {
      return res.status(400).json({ok:false, erro:"Informe um CPF válido."});
    }

    // O CPF é consultado diretamente na tabela clientes existente no Supabase.
    const clients = await centralClientsByDocument(documento);
    if (!clients.length) {
      return res.status(401).json({ok:false, erro:"CPF não encontrado no cadastro do provedor."});
    }

    // O registro central_assinantes é apenas controle de sessão/bloqueio.
    // Na primeira entrada ele é criado automaticamente, sem liberação manual.
    const accessResult = await pool.query("SELECT * FROM central_assinantes WHERE documento=$1 LIMIT 1", [documento]);
    const existingAccess = accessResult.rows[0];
    if (existingAccess && existingAccess.ativo === false) {
      return res.status(403).json({ok:false, erro:"O acesso deste CPF está bloqueado. Entre em contato com o provedor."});
    }

    const accessUpsert = await pool.query(`
      INSERT INTO central_assinantes(documento, senha_hash, ativo, cliente_principal_id, atualizado_em)
      VALUES($1, NULL, TRUE, $2, NOW())
      ON CONFLICT(documento) DO UPDATE SET
        cliente_principal_id=COALESCE(central_assinantes.cliente_principal_id, EXCLUDED.cliente_principal_id),
        tentativas_falhas=0,
        bloqueado_ate=NULL,
        atualizado_em=NOW()
      RETURNING *
    `, [documento, String(clients[0].id)]);
    const access = accessUpsert.rows[0];

    const now = Math.floor(Date.now() / 1000);
    const ttl = lembrar ? CENTRAL_SESSION_REMEMBER_TTL_SECONDS : CENTRAL_SESSION_TTL_SECONDS;
    const token = centralSignSession({acesso_id:String(access.id), documento, iat:now, exp:now+ttl});
    centralSetSessionCookie(res, token, ttl);
    await pool.query(`
      UPDATE central_assinantes
      SET tentativas_falhas=0, bloqueado_ate=NULL, ultimo_acesso=NOW(), atualizado_em=NOW()
      WHERE id=$1
    `, [access.id]);

    const principal = centralClientPublic(clients[0]);
    res.json({ok:true, fonte:"supabase", assinante:{nome:principal.nome, documento:principal.documento, pontos:clients.length}});
  } catch (error) {
    console.error("Erro /api/central/login:", error);
    res.status(500).json({ok:false, erro:"Não foi possível consultar os clientes no Supabase."});
  }
});

app.post("/api/central/logout", (_req, res) => {
  centralClearSessionCookie(res);
  res.json({ok:true});
});

app.get("/api/central/me", requireCentralSession, async (req, res) => {
  try {
    const clients = await centralClientsByDocument(req.centralSession.documento);
    if (!clients.length) {
      centralClearSessionCookie(res);
      return res.status(404).json({ok:false, erro:"Cadastro do assinante não encontrado."});
    }
    const points = await Promise.all(clients.map(async (client) => {
      const point = centralClientPublic(client);
      const data = centralDados(client);
      const planId = centralPick([client, data], ["plano_cobranca_id","planoCobrancaId","plano_id","planoId"], "");

      // Mantém cada ponto independente: se o valor não veio no cadastro do ponto,
      // busca somente o plano vinculado daquele ponto.
      if (Number(point.valorMensal || 0) === 0 && planId) {
        try {
          const plan = await pool.query("SELECT descricao, valor FROM planos_cobranca WHERE id=$1 LIMIT 1", [String(planId)]);
          if (plan.rows[0]) {
            if (plan.rows[0].descricao) point.plano = String(plan.rows[0].descricao);
            if (plan.rows[0].valor !== null && plan.rows[0].valor !== undefined) point.valorMensal = Number(plan.rows[0].valor) || 0;
          }
        } catch (_) {}
      }
      return point;
    }));
    res.json({
      ok:true,
      assinante:{
        nome:points[0].nome,
        documento:centralMaskDocument(req.centralSession.documento),
        totalPontos:points.length,
        pontos:points
      }
    });
  } catch (error) {
    res.status(500).json({ok:false, erro:error.message});
  }
});

app.get("/api/central/boletos", requireCentralSession, async (req, res) => {
  try {
    const clients = await centralClientsByDocument(req.centralSession.documento);
    const bills = await centralBillsForClients(req.centralSession.documento, clients);
    res.json({ok:true, total:bills.length, boletos:bills.map(centralBillPublic)});
  } catch (error) {
    res.status(500).json({ok:false, erro:error.message});
  }
});

app.put("/api/central/contato", requireCentralSession, async (req, res) => {
  try {
    await centralEnsureTables();
    const email = String(req.body?.email || "").trim().slice(0, 180);
    const telefone1 = String(req.body?.telefone1 || "").trim().slice(0, 40);
    const telefone2 = String(req.body?.telefone2 || "").trim().slice(0, 40);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ok:false, erro:"Informe um e-mail válido."});
    }
    const dataPatch = JSON.stringify({email, telefone1, telefone2, atualizadoPelaCentral:true, atualizadoPelaCentralEm:new Date().toISOString()});
    const result = await pool.query(`
      UPDATE clientes
      SET email=$1,
          telefone1=$2,
          telefone2=$3,
          telefone=COALESCE(NULLIF($2,''), telefone),
          dados=COALESCE(dados,'{}'::jsonb) || $4::jsonb,
          atualizado_em=NOW()
      WHERE regexp_replace(
        COALESCE(NULLIF(cpf_cnpj,''), NULLIF(dados->>'cpfCnpj',''), NULLIF(dados->>'cpf',''), NULLIF(dados->>'cnpj',''), ''),
        '[^0-9]','','g'
      )=$5
      RETURNING id
    `, [email || null, telefone1 || null, telefone2 || null, dataPatch, req.centralSession.documento]);
    res.json({ok:true, atualizados:result.rowCount});
  } catch (error) {
    res.status(500).json({ok:false, erro:error.message});
  }
});


/* Administração do acesso da Central dentro da ficha do cliente. */
app.get("/api/clientes/:id/central-acesso", async (req, res) => {
  try {
    const client = await centralClientById(req.params.id);
    if (!client) return res.status(404).json({ok:false, erro:"Cliente não encontrado."});
    const document = centralDocumentFromClient(client);
    if (!centralValidCpf(document)) {
      return res.json({ok:true, acesso:{configurado:false, ativo:false, documento:"", motivo:"Cliente sem CPF válido."}});
    }
    const result = await pool.query(`
      SELECT id, ativo, cliente_principal_id, ultimo_acesso, atualizado_em
      FROM central_assinantes
      WHERE documento=$1
      LIMIT 1
    `, [document]);
    const access = result.rows[0];
    res.json({
      ok:true,
      acesso:{
        configurado:true,
        automatico:!access,
        ativo:access ? Boolean(access.ativo) : true,
        bloqueado:Boolean(access && access.ativo === false),
        documento:centralMaskDocument(document),
        ultimoAcesso:access?.ultimo_acesso || null,
        atualizadoEm:access?.atualizado_em || null
      }
    });
  } catch (error) {
    res.status(500).json({ok:false, erro:error.message});
  }
});

app.post("/api/clientes/:id/central-acesso", async (req, res) => {
  try {
    const client = await centralClientById(req.params.id);
    if (!client) return res.status(404).json({ok:false, erro:"Cliente não encontrado."});
    const document = centralDocumentFromClient(client);
    if (!centralValidCpf(document)) {
      return res.status(400).json({ok:false, erro:"Cadastre um CPF válido antes de liberar a Central."});
    }

    const active = req.body?.ativo !== false;
    const result = await pool.query(`
      INSERT INTO central_assinantes(documento, senha_hash, ativo, cliente_principal_id, atualizado_em)
      VALUES($1, NULL, $2, $3, NOW())
      ON CONFLICT(documento) DO UPDATE SET
        ativo=$2,
        cliente_principal_id=$3,
        tentativas_falhas=0,
        bloqueado_ate=NULL,
        atualizado_em=NOW()
      RETURNING id, ativo, ultimo_acesso, atualizado_em
    `, [document, active, String(client.id)]);

    res.json({
      ok:true,
      mensagem:"Acesso pelo CPF permitido. O cadastro será consultado diretamente no Supabase.",
      acesso:{
        configurado:true,
        ativo:Boolean(result.rows[0].ativo),
        documento:centralMaskDocument(document),
        ultimoAcesso:result.rows[0].ultimo_acesso || null,
        atualizadoEm:result.rows[0].atualizado_em || null
      }
    });
  } catch (error) {
    res.status(500).json({ok:false, erro:error.message});
  }
});

app.delete("/api/clientes/:id/central-acesso", async (req, res) => {
  try {
    const client = await centralClientById(req.params.id);
    if (!client) return res.status(404).json({ok:false, erro:"Cliente não encontrado."});
    const document = centralDocumentFromClient(client);
    if (!centralValidCpf(document)) return res.status(400).json({ok:false, erro:"Cliente sem CPF válido."});
    await pool.query(`
      UPDATE central_assinantes
      SET ativo=FALSE, tentativas_falhas=0, bloqueado_ate=NULL, atualizado_em=NOW()
      WHERE documento=$1
    `, [document]);
    res.json({ok:true, mensagem:"Acesso deste CPF bloqueado na Central."});
  } catch (error) {
    res.status(500).json({ok:false, erro:error.message});
  }
});


app.get("/api/status",(req,res)=>{
  res.json({ sistema:"Fibra+ Hub 2 Servidores", status:"online", banco:!!process.env.DATABASE_URL, versao:"12.0.0" });
});

app.post("/api/update",(req,res)=>{
  const token = req.headers["x-panel-token"] || req.body.token;
  if (token !== TOKEN) return res.status(401).json({ ok:false, erro:"Token inválido" });

  let chave = (req.body.servidor || req.body.pop || req.body.identity || "colonia").toString().toLowerCase();
  if (chave.includes("armando")) chave = "armando";
  else if (chave.includes("colonia") || chave.includes("colônia")) chave = "colonia";

  if (!servidores[chave]) {
    servidores[chave] = { servidor: chave, nome: chave.toUpperCase(), online: false, clientes: [], interfaces: [] };
  }

  servidores[chave] = {
    ...servidores[chave],
    servidor: chave,
    nome: req.body.nomeServidor || servidores[chave].nome || req.body.identity || chave.toUpperCase(),
    online: true,
    atualizadoEm: new Date().toISOString(),
    origem: req.ip,
    identity: req.body.identity || servidores[chave].identity,
    cpu: req.body.cpu || "0",
    uptime: req.body.uptime || "--",
    memoriaLivre: req.body.memoriaLivre || "--",
    pppoeOnline: Number(req.body.pppoeOnline || 0),
    download: req.body.download || "0 Mbps",
    upload: req.body.upload || "0 Mbps",
    interfaces: Array.isArray(req.body.interfaces) ? req.body.interfaces : [],
    clientes: Array.isArray(req.body.clientes) ? req.body.clientes : [],
    raw: req.body
  };

  const payload = geral();
  io.emit("hub-update", payload);
  io.emit("mikrotik-update", payload);
  res.json({ ok:true, recebido:true, servidor:chave, geral: payload });
});

app.get("/api/latest",(req,res)=>res.json(geral()));

app.get("/api/status-atual", (req, res) => {
  try {
    const valores = Object.values(statusServidores || {});
    if (valores.length) {
      return res.json(valores[valores.length - 1]);
    }
    res.json({});
  } catch (e) {
    res.json({});
  }
});


app.get("/api/servidores", async (req, res) => {
  try {
    const [armandoOnline, coloniaOnline, armandoStatus, coloniaStatus] = await Promise.all([
      consultarOnlineServidor("ARMANDO"),
      consultarOnlineServidor("COLONIA"),
      consultarStatusServidor("ARMANDO"),
      consultarStatusServidor("COLONIA")
    ]);

    servidores.armando = {
      ...servidores.armando,
      servidor: "armando",
      nome: "ARMANDO MENDES",
      online: Boolean(armandoOnline.ok || armandoStatus.ok),
      atualizadoEm: new Date().toISOString(),
      identity: armandoStatus.identity || servidores.armando.identity || "ARMANDO MENDES",
      cpu: armandoStatus.cpu || "0",
      uptime: armandoStatus.uptime || "--",
      pppoeOnline: armandoOnline.total || 0,
      clientes: armandoOnline.clientes || [],
      erro: (armandoOnline.ok || armandoStatus.ok) ? "" : (armandoOnline.erro || armandoStatus.erro || "")
    };

    servidores.colonia = {
      ...servidores.colonia,
      servidor: "colonia",
      nome: "COLÔNIA ANTÔNIO ALEIXO",
      online: Boolean(coloniaOnline.ok || coloniaStatus.ok),
      atualizadoEm: new Date().toISOString(),
      identity: coloniaStatus.identity || servidores.colonia.identity || "COLÔNIA ANTÔNIO ALEIXO",
      cpu: coloniaStatus.cpu || "0",
      uptime: coloniaStatus.uptime || "--",
      pppoeOnline: coloniaOnline.total || 0,
      clientes: coloniaOnline.clientes || [],
      erro: (coloniaOnline.ok || coloniaStatus.ok) ? "" : (coloniaOnline.erro || coloniaStatus.erro || "")
    };

    return res.json(servidores);
  } catch (error) {
    return res.status(500).json({ ok:false, erro:error.message, servidores });
  }
});


app.post("/api/clientes", async (req, res) => {
  try {
    const c = req.body;
    const result = await pool.query(
      `INSERT INTO clientes 
      (nome, servidor, cpf, telefone, cep, endereco, numero, complemento, bairro, referencia, plano, pppoe, acesso_remoto, senha, vencimento, valor, status, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [
        c.nome || "",
        c.servidor || "",
        c.cpf || "",
        c.telefone || "",
        c.cep || "",
        c.endereco || "",
        c.numero || "",
        c.complemento || "",
        c.bairro || "",
        c.referencia || "",
        c.plano || "",
        c.pppoe || "",
        c.acessoRemoto || c.acesso_remoto || "",
        c.senha || "",
        c.vencimento || "",
        c.valor || "",
        c.status || "ativo",
        c.observacoes || ""
      ]
    );

    let pppoeCriado = false;
    let pppoeErro = null;

    try {
      await criarPPPoEClienteComProfile(result.rows[0]);
      pppoeCriado = true;
    } catch (erroPPPoE) {
      pppoeErro = erroPPPoE.message;
      console.error("Erro ao criar PPPoE:", erroPPPoE.message);
    }

    io.emit("cliente-criado", result.rows[0]);
    res.json({ ok: true, cliente: result.rows[0], pppoeCriado, pppoeErro });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});





function dadosClienteObjeto(cliente) {
  if (!cliente) return {};
  if (cliente.dados && typeof cliente.dados === "object") return cliente.dados;
  try { return JSON.parse(cliente.dados || "{}"); } catch (_) { return {}; }
}

function loginPPPoECliente(cliente) {
  const d = dadosClienteObjeto(cliente);
  return String(
    cliente.login_pppoe || cliente.login || cliente.pppoe ||
    d.loginPppoe || d.login_pppoe || d.login || d.cadLogin || ""
  ).trim();
}

function servidorCliente(cliente) {
  const d = dadosClienteObjeto(cliente);
  return String(cliente.servidor || cliente.pop_servidor || d.popServidor || d.servidor || d.cadPop || "").trim();
}

function ipInternoEquipamentoCliente(cliente) {
  const d = dadosClienteObjeto(cliente);
  const candidatos = [
    cliente.ip_interno, cliente.ip_equipamento, cliente.gateway, cliente.ip,
    d.ipInterno, d.ipEquipamento, d.routerIp, d.gateway, d.cadIp, d.ip
  ];
  for (const valor of candidatos) {
    const ip = String(valor || "").trim().replace(/^https?:\/\//i, "").split('/')[0];
    if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(ip)) return ip;
  }
  return "192.168.1.1";
}

function urlsAdministracao(ip, preferirHttps) {
  const host = String(ip || "").trim();
  if (!host) return [];
  const https = [`https://${host}`, `https://${host}:8443`];
  const http = [`http://${host}`, `http://${host}:8080`];
  return preferirHttps ? [...https, ...http] : [...http, ...https];
}


app.get("/api/clientes/:id/acesso-equipamento", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, erro:"Cliente não encontrado." });

    const cliente = r.rows[0];
    const login = loginPPPoECliente(cliente);
    const servidor = servidorCliente(cliente);
    if (!login) return res.status(400).json({ ok:false, erro:"Cliente sem login PPPoE cadastrado." });
    if (!servidor) return res.status(400).json({ ok:false, erro:"Cliente sem servidor/POP cadastrado." });

    const acesso = await consultarIpPPPoECliente(cliente);
    const ipInterno = ipInternoEquipamentoCliente(cliente);
    const dados = dadosClienteObjeto(cliente);
    const portaAcesso = String(
      dados.cadPortaAcesso || dados.portaAcesso || dados.porta_acesso ||
      cliente.acesso_remoto || dados.acessoRemoto || dados.acesso_remoto || ""
    ).trim();

    return res.json({
      ok: true,
      cliente_id: cliente.id,
      nome: cliente.nome || dados.nome || "",
      login_pppoe: login,
      servidor,
      online: Boolean(acesso.online),
      ip_atual: acesso.ip || "",
      ip_interno: ipInterno,
      porta_acesso: portaAcesso,
      uptime: acesso.uptime || "",
      mac: acesso.caller_id || "",
      remoto: acesso.online ? urlsAdministracao(acesso.ip, false) : [],
      interno: urlsAdministracao(ipInterno, true),
      aviso: "O navegador do técnico precisa ter rota pela VPN até o IP informado e a administração web deve estar habilitada no equipamento."
    });
  } catch (error) {
    return res.status(500).json({ ok:false, erro:error.message });
  }
});


async function testarPortasAcesso(ip, portas) {
  for (const item of portas) {
    const ok = await new Promise((resolve) => {
      const socket = new net.Socket();
      let finalizado = false;
      const fim = (valor) => {
        if (finalizado) return;
        finalizado = true;
        try { socket.destroy(); } catch(e) {}
        resolve(valor);
      };
      socket.setTimeout(1500);
      socket.once("connect", () => fim(true));
      socket.once("timeout", () => fim(false));
      socket.once("error", () => fim(false));
      socket.connect(item.port, ip);
    });
    if (ok) return { porta:item.port, protocolo:item.protocol };
  }
  return null;
}


app.get("/api/clientes/:id/testar-acesso-remoto", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) {
      return res.status(404).json({ ok:false, erro:"Cliente não encontrado." });
    }

    const cliente = r.rows[0];

    // O MikroTik é consultado somente para obter o IP PPPoE atual e descobrir
    // qual porta web responde. O acesso final continua direto pelo navegador
    // do técnico, usando a VPN já conectada no PC/celular.
    const acesso = await obterIpAtualCliente(cliente);
    if (!acesso.ip || !acesso.cfg) {
      return res.json({ ok:false, erro:"Cliente offline ou sem IP PPPoE ativo no MikroTik." });
    }

    const dados = dadosClienteObjeto(cliente);
    const portaSalvaTexto = String(
      dados.cadPortaAcesso || dados.portaAcesso || dados.porta_acesso ||
      cliente.acesso_remoto || dados.acessoRemoto || dados.acesso_remoto || ""
    ).trim();
    const portaSalvaMatch = portaSalvaTexto.match(/\d{1,5}/);
    const portaSalva = portaSalvaMatch ? Number(portaSalvaMatch[0]) : 0;

    const candidatos = [];
    const adicionar = (porta, protocolo) => {
      porta = Number(porta);
      if (!porta || porta < 1 || porta > 65535) return;
      if (candidatos.some((item) => item.porta === porta && item.protocolo === protocolo)) return;
      const portaPadrao = (protocolo === "http" && porta === 80) || (protocolo === "https" && porta === 443);
      candidatos.push({
        porta,
        protocolo,
        url:`${protocolo}://${acesso.ip}${portaPadrao ? "" : ":" + porta}`
      });
    };

    // Se já existir uma porta cadastrada, ela é validada primeiro.
    if (portaSalva) {
      const protocoloSalvo = /https/i.test(portaSalvaTexto) || [443, 8443, 9443].includes(portaSalva)
        ? "https"
        : "http";
      adicionar(portaSalva, protocoloSalvo);
    }

    // Portas comuns de administração web. 8080 vem primeiro porque é a porta
    // utilizada nos equipamentos já confirmados nesta rede.
    adicionar(8080, "http");
    adicionar(80, "http");
    adicionar(443, "https");
    adicionar(8443, "https");
    adicionar(8081, "http");
    adicionar(8000, "http");
    adicionar(8888, "http");
    adicionar(9443, "https");

    // Testa em pequenos lotes para encontrar rápido sem alterar nenhuma outra
    // parte do painel. O resultado serve apenas para montar a URL correta.
    for (let inicio = 0; inicio < candidatos.length; inicio += 4) {
      const lote = candidatos.slice(inicio, inicio + 4);
      const resultados = await Promise.all(lote.map(async (item) => {
        try {
          const teste = await testarAcessoWebPeloMikroTik(acesso.cfg, item.url);
          return { item, teste };
        } catch (error) {
          return { item, teste:{ ok:false, erro:error.message } };
        }
      }));

      const encontrado = resultados.find((resultado) => resultado.teste && resultado.teste.ok);
      if (encontrado) {
        return res.json({
          ok:true,
          ip:acesso.ip,
          acesso:{
            porta:encontrado.item.porta,
            protocolo:encontrado.item.protocolo
          },
          url:encontrado.item.url
        });
      }
    }

    return res.json({
      ok:false,
      ip:acesso.ip,
      erro:"Nenhuma porta web respondeu. Verifique se o acesso remoto está habilitado no equipamento."
    });
  } catch (error) {
    return res.status(500).json({ ok:false, erro:error.message });
  }
});

app.get("/api/clientes/:id/testar-acesso-interno", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ok:false, erro:"Cliente não encontrado"});
    const ip = ipInternoEquipamentoCliente(r.rows[0]);
    const host = String(ip).replace(/^https?:\/\//i, "").split(':')[0];
    const encontrado = await testarPortasAcesso(host, [
      {port:443, protocol:"https"},
      {port:8443, protocol:"https"}
    ]);
    return res.json({ok:!!encontrado, ip:host, acesso:encontrado});
  } catch(e) {
    return res.status(500).json({ok:false, erro:e.message});
  }
});

app.get("/api/clientes/:id/acesso-remoto", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) {
      return res.status(404).json({ ok: false, erro: "Cliente não encontrado" });
    }

    const cliente = r.rows[0];
    const acesso = await consultarIpPPPoECliente(cliente);

    res.json({
      ok: true,
      cliente_id: cliente.id,
      nome: cliente.nome,
      servidor: cliente.servidor,
      ...acesso
    });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});


async function obterIpAtualCliente(cliente) {
  const cfg = servidorConfigClientes(servidorCliente(cliente));
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + cfg.key);
  }

  const usuario = loginPPPoECliente(cliente);
  if (!usuario) throw new Error("Cliente sem usuário PPPoE.");

  const activeResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ppp/active/print",
    `?name=${usuario}`
  ]]);

  const rows = parseRouterosRows(activeResp);
  const active = rows[0];

  if (!active || !active.address) {
    throw new Error("Cliente offline ou sem IP PPPoE ativo.");
  }

  return {
    ip: active.address,
    cfg,
    pppoe: usuario,
    uptime: active.uptime || "",
    caller_id: active["caller-id"] || "",
    cfg: cfg
  };
}

async function fetchViaMikroTik(cfg, url) {
  try {
    const resp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/tool/fetch",
      `=url=${url}`,
      "=output=none",
      "=as-value="
    ]], 20000);

    const rows = parseRouterosRows(resp);
    const row = rows[0] || {};
    // Alguns RouterOS retornam campos fora do primeiro row quando usamos as-value.
    // Considera também a resposta bruta para identificar finished/downloaded.
    const texto = JSON.stringify(row) + " " + JSON.stringify(resp);

    // RouterOS pode retornar erro 301/302/401/403 quando o equipamento existe.
    // Esses retornos confirmam que a porta está aberta.
    if (/status\s*[^0-9]*(301|302|401|403)|fetch failed with status\s*(301|302|401|403)|302|301|401|403|Location|login\.html/i.test(texto)) {
      return { ok: true, row };
    }

    // RouterOS pode retornar sucesso sem HTML no campo data.
    // Exemplo real: status: finished + downloaded: 41KiB
    // Isso significa que a porta respondeu e o equipamento está acessível.
    const baixado = String(row.downloaded || row["downloaded"] || row.total || row["total"] || "" ) + " " + String(resp || "");
    const statusFetch = String(row.status || row["status"] || "" ).toLowerCase() + " " + String(resp || "").toLowerCase();
    if (statusFetch === "finished" || /\d+\s*(kib|mib|b)/i.test(baixado)) {
      return { ok: true, row, data: row.data || row.contents || "" };
    }

    const conteudo = row.data || row.contents || row["data"] || "";
    return { ok: !!(conteudo && String(conteudo).trim().length > 5), row, data: conteudo };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/status\s*[^0-9]*(301|302|401|403)|fetch failed with status\s*(301|302|401|403)|302|301|401|403|Location|login\.html/i.test(msg)) {
      return { ok: true, erro: msg };
    }
    throw e;
  }
}


app.get("/remoto/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).send("<h2>Cliente não encontrado.</h2>");

    const cliente = r.rows[0];
    const acesso = await obterIpAtualCliente(cliente);
    const alvo = `http://${acesso.ip}`;

    const html = await fetchViaMikroTik(acesso.cfg, alvo);

    if (!html || String(html).trim().length < 5) {
      return res.send(`
        <html><head><meta charset="utf-8"><title>Acesso Remoto</title></head>
        <body style="font-family:Arial;padding:30px">
          <h2>Acesso remoto localizado</h2>
          <p><b>Cliente:</b> ${cliente.nome || "--"}</p>
          <p><b>PPPoE:</b> ${cliente.pppoe || "--"}</p>
          <p><b>IP atual:</b> ${acesso.ip}</p>
          <p>O MikroTik alcança o equipamento, mas a página não retornou HTML pelo proxy.</p>
          <p>Esse proxy funciona melhor com páginas HTTP simples. Para interface completa com JavaScript, pode ser necessário VPN no técnico.</p>
        </body></html>
      `);
    }

    let conteudo = String(html);
    conteudo = conteudo.replace(/<head>/i, `<head><base href="/remoto/${req.params.id}/">`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(conteudo);
  } catch (error) {
    res.status(500).send(`
      <html><head><meta charset="utf-8"><title>Acesso Remoto</title></head>
      <body style="font-family:Arial;padding:30px">
        <h2>Erro no acesso remoto</h2>
        <p>${error.message}</p>
      </body></html>
    `);
  }
});

app.get("/api/clientes/:id/remoto-link", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, erro:"Cliente não encontrado" });

    const acesso = await obterIpAtualCliente(r.rows[0]);
    res.json({
      ok: true,
      ip: acesso.ip,
      pppoe: acesso.pppoe,
      link_proxy: `/remoto/${req.params.id}`,
      link_http_direto: `http://${acesso.ip}`
    });
  } catch (error) {
    res.status(500).json({ ok:false, erro:error.message });
  }
});

app.get("/api/clientes/:id/status-mikrotik", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) {
      return res.status(404).json({ ok: false, erro: "Cliente não encontrado" });
    }

    const cliente = r.rows[0];
    const status = await consultarStatusMikroTik(cliente);

    res.json({ ok: true, cliente_id: cliente.id, servidor: cliente.servidor, ...status });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});


async function consultarIpPPPoECliente(cliente) {
  const cfg = servidorConfigClientes(servidorCliente(cliente));
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + cfg.key);
  }

  const usuario = loginPPPoECliente(cliente);
  if (!usuario) {
    return { online: false, ip: "", erro: "Cliente sem usuário PPPoE." };
  }

  const activeResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ppp/active/print",
    `?name=${usuario}`
  ]]);

  const activeRows = parseRouterosRows(activeResp);
  const active = activeRows[0];

  if (!active) {
    return {
      online: false,
      ip: "",
      pppoe: usuario,
      mensagem: "Cliente não está online no PPPoE."
    };
  }

  return {
    online: true,
    ip: active.address || "",
    pppoe: usuario,
    uptime: active.uptime || "",
    caller_id: active["caller-id"] || ""
  };
}

app.get("/api/clientes/buscar", async (req, res) => {
  try {
    await fbEnsureTables();
    const chave = String(req.query.chave || req.query.login || req.query.cpf || req.query.id || "").trim();
    if (!chave) return res.status(400).json({ok:false, erro:"Chave do cliente não informada."});

    const somenteDigitos = chave.replace(/\D/g, "");
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(chave)) {
      const rId = await pool.query("SELECT * FROM clientes WHERE id::text=$1 LIMIT 1",[chave]);
      if (rId.rows[0]) return res.json({ok:true, cliente:fbClienteRow(rId.rows[0])});
    }
    const r = await pool.query(`
      SELECT *
      FROM clientes
      WHERE
        id::text=$1
        OR login_pppoe=$1
        OR lower(COALESCE(nome,''))=lower($1)
        OR ($2 <> '' AND regexp_replace(COALESCE(cpf_cnpj,''),'\\D','','g')=$2)
        OR dados->>'login'=$1
        OR dados->>'loginPppoe'=$1
        OR lower(COALESCE(dados->>'nome',''))=lower($1)
      ORDER BY atualizado_em DESC NULLS LAST, criado_em DESC NULLS LAST
      LIMIT 1
    `, [chave, somenteDigitos]);

    if (!r.rows[0]) return res.status(404).json({ok:false, erro:"Cliente não encontrado."});
    return res.json({ok:true, cliente:fbClienteRow(r.rows[0])});
  } catch (err) {
    console.error("Erro /api/clientes/buscar:", err);
    return res.status(500).json({ok:false, erro:err.message});
  }
});

app.get("/api/clientes/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, erro: "Cliente não encontrado" });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});


async function removerPPPoEDoServidor(cliente, servidorAntigo) {
  const dados = cliente && cliente.dados && typeof cliente.dados === "object" ? cliente.dados : {};
  const servidor = String(
    servidorAntigo || cliente.servidor || cliente.pop_servidor || dados.popServidor || dados.servidor || ""
  ).trim();
  const cfg = servidorConfigClientes(servidor);

  if (!servidor) throw new Error("Cliente sem Servidor/POP selecionado.");
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + cfg.key);
  }

  const usuario = String(
    cliente.pppoe || cliente.login_pppoe || cliente.loginPppoe || cliente.login ||
    dados.loginPppoe || dados.login_pppoe || dados.login || dados.pppoe || ""
  ).trim();
  if (!usuario) throw new Error("Cliente sem login PPPoE.");

  // Derruba somente as sessões ativas cujo nome seja exatamente o login do cadastro.
  try {
    const activeResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/ppp/active/print",
      `?name=${usuario}`
    ]]);
    const activeRows = (typeof parseRouterosRows === "function" ? parseRouterosRows(activeResp) : [])
      .filter(row => String(row.name || "").trim() === usuario);

    for (const row of activeRows) {
      const activeId = row[".id"] || row.id || "";
      if (activeId) {
        await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
          "/ppp/active/remove",
          `=.id=${activeId}`
        ]]);
      }
    }
  } catch (e) {
    console.log("Sessão ativa não encontrada ou já desconectada:", usuario);
  }

  // Localiza o Secret pelo nome exato e remove pelo .id, evitando excluir outro PPPoE.
  const secretResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ppp/secret/print",
    `?name=${usuario}`
  ]]);
  const secretRows = (typeof parseRouterosRows === "function" ? parseRouterosRows(secretResp) : [])
    .filter(row => String(row.name || "").trim() === usuario);

  if (!secretRows.length) {
    return { removido: false, inexistente: true, usuario, servidor: cfg.key };
  }

  for (const row of secretRows) {
    const secretId = row[".id"] || row.id || "";
    if (!secretId) throw new Error("Não foi possível identificar o PPPoE Secret no MikroTik.");
    await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/ppp/secret/remove",
      `=.id=${secretId}`
    ]]);
  }

  return { removido: true, inexistente: false, usuario, servidor: cfg.key };
}

async function migrarServidorCliente(clienteAntigo, clienteNovo) {
  const servidorAntigo = String(clienteAntigo.servidor || "").trim().toUpperCase();
  const servidorNovo = String(clienteNovo.servidor || "").trim().toUpperCase();

  if (!servidorAntigo || !servidorNovo || servidorAntigo === servidorNovo) {
    return { migrado: false, motivo: "Servidor não mudou" };
  }

  await removerPPPoEDoServidor(clienteAntigo, clienteAntigo.servidor);
  await criarPPPoEClienteComProfile(clienteNovo);

  return { migrado: true, de: clienteAntigo.servidor, para: clienteNovo.servidor };
}

app.put("/api/clientes/:id", async (req, res) => {
  try {
    const antesResult = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!antesResult.rows.length) return res.status(404).json({ ok: false, erro: "Cliente não encontrado" });

    const clienteAntigo = antesResult.rows[0];
    const c = req.body;

    const result = await pool.query(
      `UPDATE clientes SET
        nome=$1, servidor=$2, cpf=$3, telefone=$4, cep=$5, endereco=$6, numero=$7,
        complemento=$8, bairro=$9, referencia=$10, plano=$11, pppoe=$12, acesso_remoto=$13, senha=$14,
        vencimento=$15, valor=$16, status=$17, observacoes=$18,
        dados=COALESCE($19::jsonb, dados)
       WHERE id=$20 RETURNING *`,
      [
        c.nome || "",
        c.servidor || "",
        c.cpf || "",
        c.telefone || "",
        c.cep || "",
        c.endereco || "",
        c.numero || "",
        c.complemento || "",
        c.bairro || "",
        c.referencia || "",
        c.plano || "",
        c.pppoe || "",
        c.acessoRemoto || c.acesso_remoto || "",
        c.senha || "",
        c.vencimento || "",
        c.valor || "",
        c.status || clienteAntigo.status || "ativo",
        c.observacoes || "",
        c.dados ? JSON.stringify(c.dados) : null,
        req.params.id
      ]
    );

    const clienteNovo = result.rows[0];

    let migracao = { migrado: false };
    let migracaoErro = null;

    const servidorMudou = String(clienteAntigo.servidor || "").trim().toUpperCase() !== String(clienteNovo.servidor || "").trim().toUpperCase();
    const pppoeMudou = String(clienteAntigo.pppoe || "").trim() !== String(clienteNovo.pppoe || "").trim();

    if (servidorMudou) {
      try {
        migracao = await migrarServidorCliente(clienteAntigo, clienteNovo);
      } catch (e) {
        migracaoErro = e.message;
        console.error("Erro na migração de servidor:", e.message);
      }
    } else if (pppoeMudou) {
      // Se mudou o usuário PPPoE no mesmo servidor, remove o antigo e cria o novo.
      try {
        await removerPPPoEDoServidor(clienteAntigo, clienteAntigo.servidor);
        await criarPPPoEClienteComProfile(clienteNovo);
        migracao = { migrado: true, motivo: "PPPoE alterado no mesmo servidor" };
      } catch(e) {
        migracaoErro = e.message;
      }
    }

    res.json({ ok: true, cliente: clienteNovo, migracao, migracaoErro });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

app.post("/api/clientes/:id/bloquear", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, erro:"Cliente não encontrado" });

    const cliente = r.rows[0];
    await acaoPPPoECliente(cliente, "bloquear");
    const dadosCliente = cliente.dados && typeof cliente.dados === "object" ? cliente.dados : {};
    const profileNormal = String(cliente.profile || dadosCliente.profileNormal || cliente.plano || "").trim();
    const up = await pool.query(`UPDATE clientes SET status='bloqueado', profile='BLOQUEADO', confianca_ate='', dados=COALESCE(dados,'{}'::jsonb) || $1::jsonb, atualizado_em=NOW() WHERE id=$2 RETURNING *`, [JSON.stringify({status:"bloqueado",profile:"BLOQUEADO",profileNormal}), req.params.id]);

    res.json({ ok:true, acao:"bloqueado", cliente:up.rows[0] });
  } catch (error) {
    res.status(500).json({ ok:false, erro:error.message });
  }
});

app.post("/api/clientes/:id/desbloquear", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, erro:"Cliente não encontrado" });

    const cliente = r.rows[0];
    const dadosCliente = cliente.dados && typeof cliente.dados === "object" ? cliente.dados : {};
    const profileNormal = String(dadosCliente.profileNormal || dadosCliente.profile_normal || cliente.plano || "").trim();
    const clienteLiberar = {...cliente, profile:profileNormal || cliente.profile};
    await acaoPPPoECliente(clienteLiberar, "desbloquear");
    const up = await pool.query(`UPDATE clientes SET status='ativo', profile=$1, confianca_ate='', dados=COALESCE(dados,'{}'::jsonb) || $2::jsonb, atualizado_em=NOW() WHERE id=$3 RETURNING *`, [profileNormal || cliente.profile, JSON.stringify({status:"ativo",profile:profileNormal || cliente.profile,profileNormal:profileNormal || cliente.profile}), req.params.id]);

    res.json({ ok:true, acao:"desbloqueado", cliente:up.rows[0] });
  } catch (error) {
    res.status(500).json({ ok:false, erro:error.message });
  }
});

app.post("/api/clientes/:id/confianca", async (req, res) => {
  try {
    const dias = Number(req.body.dias || 1);
    const ate = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();

    const r = await pool.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok:false, erro:"Cliente não encontrado" });

    const cliente = r.rows[0];
    await acaoPPPoECliente(cliente, "desbloquear");
    const up = await pool.query("UPDATE clientes SET status='confianca', confianca_ate=$1 WHERE id=$2 RETURNING *", [ate, req.params.id]);

    res.json({ ok:true, acao:"confianca", confianca_ate:ate, cliente:up.rows[0] });
  } catch (error) {
    res.status(500).json({ ok:false, erro:error.message });
  }
});

app.delete("/api/clientes/:id", async (req, res) => {
  let cliente = null;
  let mikrotik = null;
  try {
    await fbEnsureTables();
    const consulta = await pool.query("SELECT * FROM clientes WHERE id::text=$1 LIMIT 1", [String(req.params.id)]);
    if (!consulta.rows.length) {
      return res.status(404).json({ ok:false, erro:"Cliente não encontrado no Supabase." });
    }

    const row = consulta.rows[0];
    const completo = typeof fbClienteRow === "function" ? fbClienteRow(row) : row;
    const dados = row.dados && typeof row.dados === "object" ? row.dados : {};
    cliente = {
      ...dados,
      ...row,
      ...completo,
      id: row.id,
      pppoe: row.pppoe || row.login_pppoe || completo.loginPppoe || dados.loginPppoe || dados.login || "",
      login_pppoe: row.login_pppoe || completo.loginPppoe || dados.loginPppoe || dados.login || "",
      servidor: row.servidor || completo.servidor || dados.popServidor || dados.servidor || "",
      senha: row.senha || dados.cadSenha || dados.senhaPppoe || dados.senha || "",
      plano: row.profile || row.plano || completo.profile || dados.profile || dados.plano || "default",
      profile: row.profile || completo.profile || dados.profile || dados.plano || "default",
      cpf: row.cpf_cnpj || row.cpf || completo.cpf || dados.cpfCnpj || dados.cpf || "",
      telefone: row.telefone || completo.telefone1 || dados.telefone1 || dados.telefone || ""
    };

    if (!String(cliente.pppoe || "").trim()) {
      return res.status(400).json({ ok:false, erro:"O cadastro não possui login PPPoE para excluir do MikroTik." });
    }
    if (!String(cliente.servidor || "").trim()) {
      return res.status(400).json({ ok:false, erro:"Selecione/registre o Servidor/POP do cliente antes de excluir." });
    }

    // Primeiro remove somente o PPPoE exato do servidor registrado no cadastro.
    mikrotik = await removerPPPoEDoServidor(cliente, cliente.servidor);

    // Depois remove somente o registro selecionado, pelo ID único do Supabase.
    const excluido = await pool.query("DELETE FROM clientes WHERE id::text=$1 RETURNING id", [String(req.params.id)]);
    if (!excluido.rows.length) throw new Error("O cliente não foi removido do Supabase.");

    return res.json({
      ok:true,
      mensagem: mikrotik && mikrotik.inexistente
        ? "Cliente removido do Supabase. O PPPoE Secret já não existia no MikroTik."
        : "Cliente removido do Supabase e do MikroTik.",
      cliente_id: String(row.id),
      login_pppoe: cliente.pppoe,
      servidor: cliente.servidor,
      mikrotik
    });
  } catch (e) {
    // Se o MikroTik foi removido, mas a exclusão do Supabase falhou, tenta restaurar o Secret.
    let restauracaoErro = "";
    if (cliente && mikrotik && mikrotik.removido) {
      try {
        await criarPPPoEClienteComProfile(cliente);
      } catch (restaurar) {
        restauracaoErro = String(restaurar.message || restaurar);
      }
    }
    return res.status(500).json({
      ok:false,
      erro: restauracaoErro
        ? `${e.message} O PPPoE foi removido, mas não pôde ser restaurado automaticamente: ${restauracaoErro}`
        : e.message
    });
  }
});


app.get("/api/mikrotik/test", async (req, res) => {
  try {
    const servidor = req.query.servidor || "COLONIA ANTONIO ALEIXO";
    const cfg = servidorConfigClientes(servidor);
    if (!cfg.host || !cfg.user || !cfg.pass) {
      return res.status(500).json({ ok: false, erro: "Variáveis do MikroTik não configuradas", servidor: cfg.key });
    }

    const resposta = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [["/system/identity/print"]]);
    res.json({ ok: true, servidor: cfg.key, host: cfg.host, resposta });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});



async function consultarOnlineServidor(nomeServidor) {
  const cfg = servidorConfigClientes(nomeServidor);

  if (!cfg.host || !cfg.user || !cfg.pass) {
    return { ok: false, servidor: cfg.key, erro: "Variáveis do MikroTik não configuradas para " + cfg.key, clientes: [], total: 0 };
  }

  try {
    const resp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [["/ppp/active/print"]], 15000);
    const rows = parseRouterosRows(resp).map((c) => ({
      name: c.name || "",
      usuario: c.name || "",
      address: c.address || "",
      ip: c.address || "",
      callerId: c["caller-id"] || "",
      uptime: c.uptime || "",
      service: c.service || "pppoe",
      servidor: cfg.key
    }));

    return { ok: true, servidor: cfg.key, total: rows.length, clientes: rows };
  } catch (error) {
    return { ok: false, servidor: cfg.key, erro: error.message, clientes: [], total: 0 };
  }
}

async function consultarStatusServidor(nomeServidor) {
  const cfg = servidorConfigClientes(nomeServidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    return { ok: false, servidor: cfg.key, erro: "Variáveis do MikroTik não configuradas para " + cfg.key };
  }

  try {
    const [identityResp, resourceResp] = await Promise.all([
      routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [["/system/identity/print"]], 12000),
      routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [["/system/resource/print"]], 12000)
    ]);
    const identity = parseRouterosRows(identityResp)[0] || {};
    const resource = parseRouterosRows(resourceResp)[0] || {};
    return {
      ok: true,
      servidor: cfg.key,
      identity: identity.name || cfg.key,
      cpu: resource["cpu-load"] || resource.cpu || "0",
      uptime: resource.uptime || "--",
      freeMemory: resource["free-memory"] || "",
      totalMemory: resource["total-memory"] || ""
    };
  } catch (error) {
    return { ok: false, servidor: cfg.key, erro: error.message };
  }
}

app.get("/api/online", async (req, res) => {
  try {
    const [armando, colonia] = await Promise.all([
      consultarOnlineServidor("ARMANDO"),
      consultarOnlineServidor("COLONIA")
    ]);
    const clientes = [ ...(armando.clientes || []), ...(colonia.clientes || []) ];
    res.json({
      ok: armando.ok || colonia.ok,
      atualizadoEm: new Date().toISOString(),
      total: clientes.length,
      servidores: { armando, colonia },
      clientes
    });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

app.get("/api/status-mikrotik", async (req, res) => {
  try {
    const [armando, colonia, online] = await Promise.all([
      consultarStatusServidor("ARMANDO"),
      consultarStatusServidor("COLONIA"),
      Promise.all([consultarOnlineServidor("ARMANDO"), consultarOnlineServidor("COLONIA")])
    ]);
    armando.pppoeOnline = online[0].total || 0;
    colonia.pppoeOnline = online[1].total || 0;
    res.json({ ok: armando.ok || colonia.ok, atualizadoEm: new Date().toISOString(), servidores: { armando, colonia } });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});


/* ============================================================
   PROFILES PPP MIKROTIK
   Retorna os profiles de velocidade do MikroTik selecionado.
   Comando RouterOS: /ppp/profile/print
============================================================ */
const cacheProfilesMikrotik = new Map();

app.get("/api/mikrotik/profiles", async (req, res) => {
  const normalizar = (v) => String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  try {
    const servidorNome = String(req.query.servidor || "").trim();
    const force = String(req.query.force || "").trim() === "1";

    if (!servidorNome || servidorNome === "-" || servidorNome === "--" || normalizar(servidorNome).includes("sem servidor")) {
      return res.json({ ok:false, profiles:[], motivo:"servidor_nao_informado" });
    }

    const cacheKey = normalizar(servidorNome);
    const cache = cacheProfilesMikrotik.get(cacheKey);
    const agora = Date.now();

    if (!force && cache && (agora - cache.ts) < 5 * 60 * 1000) {
      return res.json({ ok:true, servidor:servidorNome, profiles:cache.profiles, cache:true });
    }

    // Profiles PPP pertencem ao concentrador de clientes (RB4011 na Colônia).
    const cfg = servidorConfigClientes(servidorNome);

    if (!cfg.host || !cfg.user || !cfg.pass) {
      return res.status(500).json({
        ok:false,
        profiles:[],
        motivo:"mikrotik_nao_configurado",
        servidor: cfg.key || servidorNome,
        mensagem:"Variáveis do MikroTik não configuradas para " + (cfg.key || servidorNome)
      });
    }

    const resp = await routerosSend(
      cfg.host,
      cfg.port,
      cfg.user,
      cfg.pass,
      [["/ppp/profile/print"]],
      15000
    );

    const rows = parseRouterosRows(resp);

    const ocultar = new Set(["default", "default-encryption"]);

    const profiles = rows
      .map((p) => String(p.name || p.profile || "").trim())
      .filter(Boolean)
      .filter((name) => !ocultar.has(normalizar(name)))
      .filter((name, idx, arr) => arr.findIndex(x => normalizar(x) === normalizar(name)) === idx)
      .sort((a,b) => a.localeCompare(b, "pt-BR", { numeric:true }));

    cacheProfilesMikrotik.set(cacheKey, { ts:agora, profiles });

    return res.json({
      ok:true,
      servidor: cfg.key || servidorNome,
      profiles,
      cache:false
    });
  } catch (err) {
    console.error("Erro /api/mikrotik/profiles:", err);
    return res.status(500).json({
      ok:false,
      profiles:[],
      erro:true,
      mensagem:err.message
    });
  }
});




/* ============================================================
   GRAVAR CLIENTE NO MIKROTIK - SINCRONIZAÇÃO COMPLETA
   Se PPP Secret existe: atualiza login, senha, profile, service e comentário.
   Se não existe: cria PPP Secret completo.
============================================================ */
app.post("/api/mikrotik/cliente-profile", async (req, res) => {
  try {
    const body = fbValidarCpfCadastro({ ...(req.body || {}), origem:"Painel Fibra+ Hub" });

    // Garantia definitiva: nenhuma alteração no MikroTik ocorre antes
    // de o cliente estar persistido no Supabase.
    const clienteSupabase = await fbSalvarClienteSupabaseUnico({
      ...body,
      loginPppoe: body.loginPppoe || body.login || "",
      login: body.login || body.loginPppoe || "",
      cpfCnpj: body.cpfCnpj || body.cpf || "",
      telefone1: body.telefone1 || body.telefone || "",
      servidor: body.servidor || "",
      popServidor: body.servidor || "",
      profile: body.profile || "",
      plano: body.plano || body.profile || "",
      origem: "Painel Fibra+ Hub"
    });

    console.log(
      "Cliente confirmado no Supabase antes do MikroTik:",
      clienteSupabase.loginPppoe || clienteSupabase.login,
      clienteSupabase.id
    );

    const servidor = String(body.servidor || "").trim();
    const login = String(body.login || "").trim();
    const loginAnterior = String(body.loginAnterior || body.login_antigo || "").trim();
    const senha = String(body.senha || "").trim();
    const profile = String(body.profile || "").trim();
    const nome = String(body.nome || "").trim();
    const telefone = String(body.telefone || "").trim();
    const cpf = fbFormatarCpf(body.cpf || body.cpfCnpj || "");

    if (!servidor || servidor === "-" || servidor === "--" || servidor.toLowerCase().includes("sem servidor")) {
      return res.status(400).json({ ok:false, erro:"Servidor não selecionado." });
    }

    if (!login) {
      return res.status(400).json({ ok:false, erro:"Login PPPoE não informado." });
    }

    if (!profile) {
      return res.status(400).json({ ok:false, erro:"PROFILE não selecionado." });
    }

    const cfg = servidorConfigClientes(servidor);

    if (!cfg.host || !cfg.user || !cfg.pass) {
      return res.status(500).json({
        ok:false,
        erro:"Variáveis do MikroTik não configuradas para " + (cfg.key || servidor)
      });
    }

    // Confere se o profile existe no concentrador PPPoE.
    const profilesResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [["/ppp/profile/print"]], 15000);
    const profiles = parseRouterosRows(profilesResp);
    const profileExiste = profiles.some((p) => String(p.name || "").trim() === profile);

    if (!profileExiste) {
      return res.status(400).json({
        ok:false,
        erro:"PROFILE não existe nesse MikroTik: " + profile
      });
    }

    async function buscarSecret(nomeLogin) {
      if (!nomeLogin) return null;

      const resp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
        "/ppp/secret/print",
        "?name=" + nomeLogin
      ]], 15000);

      const rows = parseRouterosRows(resp);
      return rows[0] || null;
    }

    // Para alteração de login:
    // 1. procura primeiro pelo login antigo do cadastro;
    // 2. se não achar, procura pelo login atual.
    let secret = null;
    let encontradoPor = "";

    if (loginAnterior && loginAnterior !== login) {
      secret = await buscarSecret(loginAnterior);
      if (secret) encontradoPor = loginAnterior;
    }

    if (!secret) {
      secret = await buscarSecret(login);
      if (secret) encontradoPor = login;
    }

    // Comentário padronizado no PPP Secret: NOME COMPLETO: CPF.
    const comentario = montarComentarioClienteMikrotik({
      nome,
      cpf,
      login
    });

    if (secret && secret[".id"]) {
      const words = [
        "/ppp/secret/set",
        "=.id=" + secret[".id"],
        "=name=" + login,
        senha ? "=password=" + senha : "",
        "=service=pppoe",
        "=profile=" + profile,
        comentario ? "=comment=" + comentario : ""
      ].filter(Boolean);

      await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [words], 15000);

      return res.json({
        ok:true,
        acao:"atualizado",
        mensagem:"Cliente atualizado no MikroTik com o comentário no padrão NOME COMPLETO: CPF.",
        servidor: cfg.key || servidor,
        login,
        loginAnterior: encontradoPor || loginAnterior || login,
        profile
      });
    }

    if (!senha) {
      return res.status(400).json({
        ok:false,
        erro:"Cliente não existe no MikroTik. Informe a senha para criar o PPP Secret."
      });
    }

    await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/ppp/secret/add",
      "=name=" + login,
      "=password=" + senha,
      "=service=pppoe",
      "=profile=" + profile,
      comentario ? "=comment=" + comentario : ""
    ].filter(Boolean)], 15000);

    return res.json({
      ok:true,
      acao:"criado",
      mensagem:"Cliente criado no MikroTik com o comentário no padrão NOME COMPLETO: CPF.",
      servidor: cfg.key || servidor,
      login,
      profile
    });
  } catch (err) {
    console.error("Erro /api/mikrotik/cliente-profile:", err);
    return res.status(500).json({
      ok:false,
      erro:err.message
    });
  }
});




/* ============================================================
   COBRANÇA MIKROTIK - BLOQUEIO POR PROFILE
   Bloquear = profile BLOQUEADO, disabled=no.
   Liberar/Confiança/Pagamento = profile do cadastro, disabled=no.
============================================================ */
function requireFibraOuCentralSession(req, res, next) {
  const central = centralReadSession(req);
  if (central) {
    req.centralSession = central;
    return next();
  }

  const admin = readSession(req);
  if (admin) {
    req.session = admin;
    return next();
  }

  return res.status(401).json({ok:false, erro:"Sessão inválida ou expirada."});
}

app.post("/api/mikrotik/cliente-acao", requireFibraOuCentralSession, async (req, res) => {
  const normalizar = (v) => String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  async function derrubarSessao(cfg, login) {
    try {
      const activeResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
        "/ppp/active/print",
        "?name=" + login
      ]], 15000);

      const activeRows = parseRouterosRows(activeResp);

      for (const active of activeRows) {
        if (active && active[".id"]) {
          await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
            "/ppp/active/remove",
            "=.id=" + active[".id"]
          ]], 15000);
        }
      }
    } catch (e) {
      console.error("Erro ao derrubar sessão ativa:", e.message);
    }
  }

  async function garantirProfileBloqueado(cfg) {
    const profilesResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [["/ppp/profile/print"]], 15000);
    const profiles = parseRouterosRows(profilesResp);
    const existe = profiles.some((p) => normalizar(p.name) === "bloqueado");

    if (existe) return;

    await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/ppp/profile/add",
      "=name=BLOQUEADO",
      "=comment=CRIADO PELO FIBRA+ HUB"
    ]], 15000);
  }

  async function profileExiste(cfg, profile) {
    const profilesResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [["/ppp/profile/print"]], 15000);
    const profiles = parseRouterosRows(profilesResp);
    return profiles.some((p) => String(p.name || "").trim() === profile);
  }

  try {
    const body = req.body || {};
    const servidor = String(body.servidor || "").trim();
    const login = String(body.login || "").trim();
    const acao = String(body.acao || "").trim().toLowerCase();
    const dias = Number(body.dias || 0);
    let profileCadastro = String(body.profile || body.profileCadastro || "").trim();
    const clienteId = String(body.clienteId || body.cliente_id || "").trim();
    let clienteBanco = null;
    try {
      const consulta = clienteId
        ? await pool.query("SELECT * FROM clientes WHERE id=$1 LIMIT 1", [clienteId])
        : await pool.query("SELECT * FROM clientes WHERE login_pppoe=$1 OR dados->>'login'=$1 OR dados->>'loginPppoe'=$1 ORDER BY atualizado_em DESC NULLS LAST LIMIT 1", [login]);
      clienteBanco = consulta.rows[0] || null;

      // v83: reforço de sincronização de bloqueio.
      // Alguns clientes são bloqueados no MikroTik mas não eram localizados
      // pelo filtro porque o login recebido pode não ser exatamente igual ao cadastro.
      if (!clienteBanco && login) {
        const buscaExtra = await pool.query(`
          SELECT *
          FROM clientes
          WHERE dados->>'login'=$1
             OR dados->>'loginPppoe'=$1
             OR dados->>'login_pppoe'=$1
          ORDER BY atualizado_em DESC NULLS LAST
          LIMIT 1
        `, [login]);
        clienteBanco = buscaExtra.rows[0] || null;
      }

      const dadosBanco = clienteBanco && clienteBanco.dados && typeof clienteBanco.dados === "object" ? clienteBanco.dados : {};
      if (acao !== "bloquear" && (!profileCadastro || String(profileCadastro).toUpperCase() === "BLOQUEADO")) {
        profileCadastro = String(dadosBanco.profileNormal || dadosBanco.profile_normal || "").trim();
      }
    } catch (e) {
      console.warn("Não foi possível consultar o cadastro para sincronizar o profile:", e.message);
    }

    if (!servidor || servidor === "-" || servidor === "--" || normalizar(servidor).includes("sem servidor")) {
      return res.status(400).json({ ok:false, erro:"Servidor não selecionado." });
    }

    if (!login) {
      return res.status(400).json({ ok:false, erro:"Login PPPoE não informado." });
    }

    if (!["bloquear", "liberar", "confianca", "pagamento"].includes(acao)) {
      return res.status(400).json({ ok:false, erro:"Ação inválida." });
    }

    const cfg = servidorConfigClientes(servidor);

    if (!cfg.host || !cfg.user || !cfg.pass) {
      return res.status(500).json({
        ok:false,
        erro:"Variáveis do MikroTik não configuradas para " + (cfg.key || servidor)
      });
    }

    const secretResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/ppp/secret/print",
      "?name=" + login
    ]], 15000);

    const secrets = parseRouterosRows(secretResp);
    const secret = secrets[0];

    if (!secret || !secret[".id"]) {
      return res.status(404).json({
        ok:false,
        erro:"PPP Secret não encontrado no MikroTik para o login: " + login
      });
    }

    let mensagem = "";
    let confiancaAte = null;

    if (acao === "bloquear") {
      await garantirProfileBloqueado(cfg);

      await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
        "/ppp/secret/set",
        "=.id=" + secret[".id"],
        "=disabled=no",
        "=profile=BLOQUEADO"
      ]], 15000);

      await derrubarSessao(cfg, login);
      mensagem = "Cliente bloqueado no MikroTik usando profile BLOQUEADO.";
    }

    if (acao === "liberar" || acao === "pagamento") {
      if (!profileCadastro) {
        return res.status(400).json({ ok:false, erro:"PROFILE do cadastro não informado para liberar o cliente." });
      }

      const existe = await profileExiste(cfg, profileCadastro);
      if (!existe) {
        return res.status(400).json({ ok:false, erro:"PROFILE do cadastro não existe nesse MikroTik: " + profileCadastro });
      }

      await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
        "/ppp/secret/set",
        "=.id=" + secret[".id"],
        "=disabled=no",
        "=profile=" + profileCadastro
      ]], 15000);

      await derrubarSessao(cfg, login);
      mensagem = acao === "pagamento"
        ? "Pagamento confirmado. Cliente desbloqueado e voltou para o profile " + profileCadastro + "."
        : "Cliente liberado no MikroTik com profile " + profileCadastro + ".";
    }

    if (acao === "confianca") {
      if (!dias || dias <= 0) {
        return res.status(400).json({ ok:false, erro:"Informe a quantidade de dias para liberar em confiança." });
      }

      if (!profileCadastro) {
        return res.status(400).json({ ok:false, erro:"PROFILE do cadastro não informado para confiança." });
      }

      const existe = await profileExiste(cfg, profileCadastro);
      if (!existe) {
        return res.status(400).json({ ok:false, erro:"PROFILE do cadastro não existe nesse MikroTik: " + profileCadastro });
      }

      await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
        "/ppp/secret/set",
        "=.id=" + secret[".id"],
        "=disabled=no",
        "=profile=" + profileCadastro
      ]], 15000);

      await derrubarSessao(cfg, login);

      const dt = new Date();
      dt.setDate(dt.getDate() + dias);
      confiancaAte = dt.toISOString();

      mensagem = "Cliente liberado em confiança por " + dias + " dia(s), até " + confiancaAte + ".";
    }

    const profileResultado = acao === "bloquear" ? "BLOQUEADO" : profileCadastro;
    let profileNormal = profileCadastro;
    if (clienteBanco) {
      const dadosBanco = clienteBanco.dados && typeof clienteBanco.dados === "object" ? clienteBanco.dados : {};
      if (acao === "bloquear") {
        const atual = String(clienteBanco.profile || "").trim();
        profileNormal = String(
          (atual && atual.toUpperCase() !== "BLOQUEADO" ? atual : "") ||
          dadosBanco.profileNormal || dadosBanco.profile_normal || profileCadastro || ""
        ).trim();
      }
      const statusBanco = acao === "bloquear" ? "bloqueado" : (acao === "confianca" ? "confianca" : "ativo");
      const complemento = {
        status:statusBanco,
        profile:profileResultado,
        perfil:profileResultado,
        profileNormal:profileNormal,
        profileAtualizadoEm:new Date().toISOString()
      };
      await pool.query(`
        UPDATE clientes SET
          status=$1,
          profile=$2,
          confianca_ate=$3,
          dados=COALESCE(dados,'{}'::jsonb) || $4::jsonb,
          atualizado_em=NOW()
        WHERE id=$5
      `, [statusBanco, profileResultado, confiancaAte || "", JSON.stringify(complemento), clienteBanco.id]);
    }

    // v88: garante sincronização do bloqueio sempre após sucesso no MikroTik.
    // Não depende somente do carregamento inicial do cadastro.
    if (acao === "bloquear") {
      try {
        await pool.query(`
          UPDATE clientes
          SET status=$1,
              profile=$2,
              dados=COALESCE(dados,'{}'::jsonb) || $3::jsonb,
              atualizado_em=NOW()
          WHERE login_pppoe=$4
             OR dados->>'login'=$4
             OR dados->>'loginPppoe'=$4
             OR dados->>'login_pppoe'=$4
        `, [
          "bloqueado",
          "BLOQUEADO",
          JSON.stringify({
            status:"bloqueado",
            profile:"BLOQUEADO",
            perfil:"BLOQUEADO",
            profileAtualizadoEm:new Date().toISOString()
          }),
          login
        ]);
      } catch(e) {
        console.warn("v87: falha na sincronização extra do bloqueio:", e.message);
      }
    }

    return res.json({
      ok:true,
      acao,
      login,
      servidor: cfg.key || servidor,
      profile: profileResultado,
      profileNormal,
      dias: acao === "confianca" ? dias : null,
      confianca_ate: confiancaAte,
      mensagem
    });
  } catch (err) {
    console.error("Erro /api/mikrotik/cliente-acao:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});




/* ============================================================
   ROTA DE INTERNET POR CLIENTE - COLONIA ANTONIO ALEIXO
   Usa o IP PPPoE ATUAL e as address-lists já preparadas na RB:
   - CLIENTES-STARLINK
   - CLIENTES-AMAZONET
============================================================ */
const FIBRA_ROTA_LISTAS = {
  STARLINK: "CLIENTES-STARLINK",
  AMAZONET: "CLIENTES-AMAZONET"
};

const FIBRA_ROTA_TABELAS = {
  STARLINK: "CLIENTE-STARLINK",
  AMAZONET: "CLIENTE-AMAZONET"
};

function fibraNormalizarTexto(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function fibraServidorEhColonia(nomeServidor) {
  const n = fibraNormalizarTexto(nomeServidor);
  if (!n) return false;
  if (n.includes("armando") || n.includes("zumbi")) return false;
  return n === "colonia" || n.includes("colonia antonio aleixo") || n.includes("antonio aleixo");
}

async function fibraSessaoPPPoEAtual(cfg, login) {
  const resposta = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ppp/active/print",
    "?name=" + login,
    "=.proplist=.id,name,address,uptime,caller-id"
  ]], 15000);
  const linhas = parseRouterosRows(resposta);
  const alvo = fibraNormalizarTexto(login);
  const sessao = linhas.find((r) => fibraNormalizarTexto(r.name) === alvo) || linhas[0] || null;
  if (!sessao || !sessao.address) return null;
  const ip = String(sessao.address || "").split("/")[0].trim();
  if (net.isIP(ip) !== 4) return null;
  return { ...sessao, ip };
}

async function fibraListarEntradasRota(cfg, lista, ip) {
  const comando = [
    "/ip/firewall/address-list/print",
    "?list=" + lista,
    "=.proplist=.id,list,address,comment,disabled"
  ];
  if (ip) comando.splice(2, 0, "?address=" + ip);
  const resposta = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [comando], 15000);
  return parseRouterosRows(resposta);
}

async function fibraListarRotasPadrao(cfg) {
  const resposta = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ip/route/print",
    "?dst-address=0.0.0.0/0",
    "=.proplist=.id,dst-address,routing-table,gateway,immediate-gw,distance,comment,active,inactive,disabled"
  ]], 15000);
  return parseRouterosRows(resposta);
}

function fibraRouterosVerdadeiro(valor) {
  return ["true", "yes", "1"].includes(String(valor || "").toLowerCase());
}

function fibraIdentificarLinkDaRota(row) {
  const gateway = String(row?.gateway || "").toLowerCase();
  const imediato = String(row?.["immediate-gw"] || "").toLowerCase();
  const comentario = fibraNormalizarTexto(row?.comment || "");

  if (gateway.includes("208.67.222.222")) return "STARLINK";
  if (gateway.includes("208.67.220.220")) return "AMAZONET";
  if (imediato.includes("100.64.0.1") || imediato.includes("ether5")) return "STARLINK";
  if (imediato.includes("192.168.1.1") || imediato.includes("ether2")) return "AMAZONET";
  if (comentario.includes("backup amazonet")) return "AMAZONET";
  if (comentario.includes("backup starlink")) return "STARLINK";
  if (comentario.includes("amazonet")) return "AMAZONET";
  if (comentario.includes("starlink")) return "STARLINK";
  return null;
}

function fibraStatusLinkEmUso(rotas, preferencia, explicita) {
  // A saída global é decidida EXCLUSIVAMENTE pela tabela main da RB3011.
  // As tabelas CLIENTE-* e a preferência individual não entram na escolha do link em uso.
  const tabela = "main";
  if (!Array.isArray(rotas)) {
    return { emUso:null, contingencia:false, tabelaRoteamento:tabela };
  }

  const candidatas = rotas
    .filter((row) => {
      const tabelaRow = String(row["routing-table"] || "main").trim();
      return tabelaRow === tabela &&
        String(row["dst-address"] || "") === "0.0.0.0/0" &&
        !fibraRouterosVerdadeiro(row.disabled);
    })
    .sort((a, b) => {
      const da = Number(a.distance ?? 9999);
      const db = Number(b.distance ?? 9999);
      return da - db;
    });

  // RouterOS expõe active=true para a rota efetivamente instalada.
  let ativa = candidatas.find((row) => fibraRouterosVerdadeiro(row.active));

  // Fallback apenas para versões/respostas em que "active" não venha na proplist:
  // considera rota não-inativa com immediate-gw e respeita a menor distance.
  if (!ativa) {
    ativa = candidatas.find((row) =>
      !fibraRouterosVerdadeiro(row.inactive) &&
      Boolean(String(row["immediate-gw"] || "").trim())
    );
  }

  const emUso = ativa ? fibraIdentificarLinkDaRota(ativa) : null;

  return {
    emUso,
    contingencia:Boolean(emUso && preferencia && emUso !== preferencia),
    tabelaRoteamento:tabela
  };
}

async function fibraRemoverEntradasRota(cfg, login, ipAtual) {
  // Limpa a rota anterior pelo IP atual E pelo comentário do Fibra+.
  // Isso evita o caso em que o PPPoE troca de IP e a entrada antiga fica presa.
  const ids = new Set();
  const loginNorm = fibraNormalizarTexto(login);
  const marcadorLogin = loginNorm ? "fibra+ rota " + loginNorm : "";

  for (const lista of Object.values(FIBRA_ROTA_LISTAS)) {
    const linhas = await fibraListarEntradasRota(cfg, lista, "");
    for (const row of linhas) {
      const endereco = String(row.address || "").split("/")[0].trim();
      if (endereco === "127.0.0.1") continue; // reserva do painel

      const mesmoIp = Boolean(ipAtual && endereco === ipAtual);
      const comentarioNorm = fibraNormalizarTexto(row.comment || "");
      const mesmoLogin = Boolean(marcadorLogin && comentarioNorm.includes(marcadorLogin));

      if ((mesmoIp || mesmoLogin) && row[".id"]) ids.add(row[".id"]);
    }
  }

  if (!ids.size) return 0;
  const comandos = [...ids].map((id) => [
    "/ip/firewall/address-list/remove",
    "=.id=" + id
  ]);
  await fibraRouterosBatchStable(cfg, comandos, 20000, { ignorarItemAusente:true });
  return ids.size;
}

function fibraRouterosBatchStable(cfg, commands, timeoutMs = 20000, options = {}) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(commands) || commands.length === 0) return resolve([]);

    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let stage = "login";
    let finished = false;
    const doneTags = new Set();
    const respostas = [];

    const finish = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (_) {}
      if (err) reject(err);
      else resolve(respostas);
    };

    const timer = setTimeout(() => finish(new Error("Timeout executando lote na API MikroTik")), timeoutMs);
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(new Error("Timeout conectando na API MikroTik")));
    socket.on("error", (err) => finish(err));

    socket.on("data", (chunk) => {
      if (finished) return;
      buffer = Buffer.concat([buffer, chunk]);
      const sentences = parseSentences(buffer);
      if (!sentences.length) return;

      if (stage === "login") {
        const trap = sentences.find((sentence) => sentence.includes("!trap") || sentence.includes("!fatal"));
        if (trap) return finish(new Error("Falha no login da API MikroTik: " + trap.join(" ")));
        if (!sentences.some((sentence) => sentence.includes("!done"))) return;

        stage = "commands";
        buffer = Buffer.alloc(0);
        commands.forEach((words, index) => {
          socket.write(encodeSentence([...words, `.tag=fibra-rota-${index}`]));
        });
        return;
      }

      for (const sentence of sentences) {
        const tagWord = sentence.find((word) => String(word).startsWith(".tag="));
        const tag = tagWord ? String(tagWord).slice(5) : "";
        if (!tag.startsWith("fibra-rota-")) continue;

        const itemAusente = sentence.some((word) =>
          /^=message=.*\bno such item\b/i.test(String(word))
        );
        if (sentence.includes("!trap") && options.ignorarItemAusente && itemAusente) {
          // As conexões do conntrack são dinâmicas e podem expirar entre o
          // print e o remove. Nesse caso o estado desejado já foi alcançado.
          respostas.push(sentence);
          doneTags.add(tag);
          continue;
        }

        if (sentence.includes("!trap") || sentence.includes("!fatal")) {
          return finish(new Error("Erro retornado pelo MikroTik no lote: " + sentence.join(" ")));
        }

        respostas.push(sentence);
        if (sentence.includes("!done")) doneTags.add(tag);
      }

      if (doneTags.size >= commands.length) finish(null);
    });

    socket.connect(Number(cfg.port || 8728), cfg.host, () => {
      socket.write(encodeSentence(["/login", `=name=${cfg.user}`, `=password=${cfg.pass}`]));
    });
  });
}

async function fibraLimparConexoesDoIp(cfg, ip) {
  // A API RouterOS não aceita regex em query words. Para não baixar a tabela
  // completa com todos os campos, solicita somente .id e src-address e filtra
  // localmente as conexões originadas pelo IP do assinante.
  const resposta = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/ip/firewall/connection/print",
    "=.proplist=.id,src-address"
  ]], 20000);
  const linhas = parseRouterosRows(resposta);
  const ids = linhas
    .filter((row) => {
      const src = String(row["src-address"] || "").trim();
      return src === ip || src.startsWith(ip + ":");
    })
    .map((row) => row[".id"])
    .filter(Boolean);

  if (!ids.length) return 0;

  // Evita uma sentença excessivamente grande em clientes com muitas conexões.
  const lote = 80;
  for (let i = 0; i < ids.length; i += lote) {
    const comandos = ids.slice(i, i + lote).map((id) => [
      "/ip/firewall/connection/remove",
      "=.id=" + id
    ]);
    await fibraRouterosBatchStable(cfg, comandos, 20000, { ignorarItemAusente:true });
  }
  return ids.length;
}

async function fibraSalvarPreferenciaRotaBanco({ clienteId, login, rota, ip }) {
  try {
    let cliente = null;
    if (clienteId) {
      const q = await pool.query("SELECT id FROM clientes WHERE id=$1 LIMIT 1", [clienteId]);
      cliente = q.rows[0] || null;
    }
    if (!cliente && login) {
      const q = await pool.query(`
        SELECT id FROM clientes
        WHERE login_pppoe=$1
           OR dados->>'login'=$1
           OR dados->>'loginPppoe'=$1
           OR dados->>'login_pppoe'=$1
        ORDER BY atualizado_em DESC NULLS LAST
        LIMIT 1
      `, [login]);
      cliente = q.rows[0] || null;
    }
    if (!cliente) return;

    await pool.query(`
      UPDATE clientes
      SET dados=COALESCE(dados,'{}'::jsonb) || $1::jsonb,
          atualizado_em=NOW()
      WHERE id=$2
    `, [JSON.stringify({
      rotaInternet: rota,
      rotaInternetIp: ip,
      rotaInternetAtualizadoEm: new Date().toISOString()
    }), cliente.id]);
  } catch (e) {
    console.warn("Não foi possível registrar a preferência de rota no banco:", e.message);
  }
}

app.get("/api/mikrotik/diagnostico-colonia-dual", async (req, res) => {
  const cfgClientes = servidorConfigClientes("colonia");
  const cfgLinks = servidorConfigLinks("colonia");

  const testar = async (cfg, papel) => {
    const inicio = Date.now();
    try {
      if (!cfg.host || !cfg.user || !cfg.pass) throw new Error("Configuração incompleta");
      const resposta = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
        "/system/identity/print",
        "=.proplist=name"
      ]], 10000);
      const rows = parseRouterosRows(resposta);
      return {
        papel,
        ok:true,
        identidade:String(rows[0]?.name || ""),
        porta:Number(cfg.port || 8728),
        ms:Date.now()-inicio
      };
    } catch (e) {
      return {
        papel,
        ok:false,
        porta:Number(cfg.port || 8728),
        erro:String(e.message || e),
        ms:Date.now()-inicio
      };
    }
  };

  const [clientes, links] = await Promise.all([
    testar(cfgClientes, "RB4011-clientes"),
    testar(cfgLinks, "RB3011-links")
  ]);
  return res.json({ ok:clientes.ok && links.ok, clientes, links });
});

app.get("/api/mikrotik/cliente-rota", async (req, res) => {
  try {
    const servidor = String(req.query.servidor || "").trim();
    const login = String(req.query.login || "").trim();

    if (!fibraServidorEhColonia(servidor)) {
      return res.status(400).json({ ok:false, erro:"A seleção de link está disponível somente para a Colônia Antônio Aleixo." });
    }
    if (!login) return res.status(400).json({ ok:false, erro:"Login PPPoE não informado." });

    const cfgLinks = servidorConfigLinks(servidor);         // RB3011: links, rotas e address-lists
    const cfgClientes = servidorConfigClientes(servidor);  // RB4011: PPPoE

    if (!cfgLinks.host || !cfgLinks.user || !cfgLinks.pass) {
      return res.status(500).json({ ok:false, erro:"RB3011 de links da Colônia não configurada no servidor do painel." });
    }
    if (!cfgClientes.host || !cfgClientes.user || !cfgClientes.pass) {
      return res.status(500).json({ ok:false, erro:"RB4011 de clientes da Colônia não configurada no servidor do painel." });
    }

    const sessao = await fibraSessaoPPPoEAtual(cfgClientes, login);
    if (!sessao) {
      return res.json({ ok:true, online:false, rota:null, ip:"", login, mensagem:"Cliente offline ou sem IP PPPoE ativo." });
    }

    const [star, amz, resultadoRotas] = await Promise.all([
      fibraListarEntradasRota(cfgLinks, FIBRA_ROTA_LISTAS.STARLINK, sessao.ip),
      fibraListarEntradasRota(cfgLinks, FIBRA_ROTA_LISTAS.AMAZONET, sessao.ip),
      fibraListarRotasPadrao(cfgLinks)
        .then((rotas) => ({ rotas, erro:"" }))
        .catch((erro) => ({ rotas:[], erro:erro.message }))
    ]);

    if (star.length && amz.length) {
      return res.json({
        ok:true, online:true, ip:sessao.ip, login,
        rota:"CONFLITO", explicita:true,
        emUso:null, contingencia:false, statusEmUso:"conflito",
        mensagem:"O IP está nas duas listas de roteamento. Selecione STARLINK ou AMAZONET para corrigir."
      });
    }

    const rota = amz.length ? "AMAZONET" : "STARLINK";
    const explicita = Boolean(star.length || amz.length);
    const statusLink = fibraStatusLinkEmUso(resultadoRotas.rotas, rota, explicita);
    return res.json({
      ok:true,
      online:true,
      ip:sessao.ip,
      login,
      rota,
      explicita,
      ...statusLink,
      statusEmUso: statusLink.emUso ? "ok" : (resultadoRotas.erro ? "indisponivel" : "sem-rota-ativa"),
      origem: amz.length ? FIBRA_ROTA_LISTAS.AMAZONET : (star.length ? FIBRA_ROTA_LISTAS.STARLINK : "ROTA PRINCIPAL DA RB")
    });
  } catch (err) {
    console.error("Erro /api/mikrotik/cliente-rota GET:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.post("/api/mikrotik/cliente-rota", async (req, res) => {
  try {
    const body = req.body || {};
    const servidor = String(body.servidor || "").trim();
    const login = String(body.login || "").trim();
    const rota = String(body.rota || "").trim().toUpperCase();
    const clienteId = String(body.clienteId || body.cliente_id || "").trim();

    if (!fibraServidorEhColonia(servidor)) {
      return res.status(400).json({ ok:false, erro:"A seleção de link está disponível somente para a Colônia Antônio Aleixo." });
    }
    if (!login) return res.status(400).json({ ok:false, erro:"Login PPPoE não informado." });
    if (!Object.prototype.hasOwnProperty.call(FIBRA_ROTA_LISTAS, rota)) {
      return res.status(400).json({ ok:false, erro:"Link inválido. Use STARLINK ou AMAZONET." });
    }

    const cfgLinks = servidorConfigLinks(servidor);         // RB3011: links, rotas e address-lists
    const cfgClientes = servidorConfigClientes(servidor);  // RB4011: PPPoE

    if (!cfgLinks.host || !cfgLinks.user || !cfgLinks.pass) {
      return res.status(500).json({ ok:false, erro:"RB3011 de links da Colônia não configurada no servidor do painel." });
    }
    if (!cfgClientes.host || !cfgClientes.user || !cfgClientes.pass) {
      return res.status(500).json({ ok:false, erro:"RB4011 de clientes da Colônia não configurada no servidor do painel." });
    }

    const sessao = await fibraSessaoPPPoEAtual(cfgClientes, login);
    if (!sessao) {
      return res.status(409).json({ ok:false, erro:"Cliente está offline ou sem IP PPPoE ativo. A troca não foi aplicada." });
    }

    // Nunca permite o mesmo IP simultaneamente nas duas listas e também remove
    // uma entrada antiga criada pelo Fibra+ para o mesmo login caso o IP tenha mudado.
    const removidas = await fibraRemoverEntradasRota(cfgLinks, login, sessao.ip);
    const listaDestino = FIBRA_ROTA_LISTAS[rota];
    const comentario = "FIBRA+ ROTA " + login;

    await routerosSend(cfgLinks.host, cfgLinks.port, cfgLinks.user, cfgLinks.pass, [[
      "/ip/firewall/address-list/add",
      "=list=" + listaDestino,
      "=address=" + sessao.ip,
      "=comment=" + comentario
    ]], 15000);

    const conexoesRemovidas = await fibraLimparConexoesDoIp(cfgLinks, sessao.ip);

    const confirmacao = await fibraListarEntradasRota(cfgLinks, listaDestino, sessao.ip);
    if (!confirmacao.length) {
      throw new Error("A RB não confirmou o IP na lista " + listaDestino + ".");
    }

    const resultadoRotas = await fibraListarRotasPadrao(cfgLinks)
      .then((rotas) => ({ rotas, erro:"" }))
      .catch((erro) => ({ rotas:[], erro:erro.message }));
    const statusLink = fibraStatusLinkEmUso(resultadoRotas.rotas, rota, true);

    await fibraSalvarPreferenciaRotaBanco({ clienteId, login, rota, ip:sessao.ip });

    return res.json({
      ok:true,
      login,
      ip:sessao.ip,
      rota,
      ...statusLink,
      statusEmUso: statusLink.emUso ? "ok" : (resultadoRotas.erro ? "indisponivel" : "sem-rota-ativa"),
      lista:listaDestino,
      entradasRemovidas:removidas,
      conexoesRemovidas,
      mensagem:"Cliente " + login + " direcionado para " + rota + "."
    });
  } catch (err) {
    console.error("Erro /api/mikrotik/cliente-rota POST:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});







/* ============================================================
   CONTROLE GERAL DE ROTA - TODOS CLIENTES ATIVOS
============================================================ */
app.post("/api/mikrotik/rota-geral", async (req, res) => {
  try {
    const rota = String((req.body || {}).rota || "").toUpperCase();
    if (!FIBRA_ROTA_LISTAS[rota]) return res.status(400).json({ok:false, erro:"Rota inválida"});
    const cfgLinks = servidorConfigLinks("colonia");
    const cfgClientes = servidorConfigClientes("colonia");
    if (!cfgLinks || !cfgLinks.host) return res.status(500).json({ok:false, erro:"RB3011 de links não configurada"});
    if (!cfgClientes || !cfgClientes.host) return res.status(500).json({ok:false, erro:"RB4011 de clientes não configurada"});
    // ROTA GERAL: busca todos os PPP ativos na RB4011.
    // Alguns RouterOS/API retornam lista parcial quando usamos .proplist em massa.
    const ativos = await routerosCommandStable(cfgClientes, [
      "/ppp/active/print"
    ], 30000);
    const clientes = parseRouterosRows(ativos).filter(x => x.name && x.address);

    // ROTA GERAL: limpa somente clientes das listas de rota antes de recriar.
    // Mantém o IP reserva 127.0.0.1.
    for (const lista of Object.values(FIBRA_ROTA_LISTAS)) {
      const entradas = await fibraListarEntradasRota(cfgLinks, lista, "");
      const remover = entradas
        .filter(e => String(e.address || "").split("/")[0] !== "127.0.0.1")
        .map(e => ["/ip/firewall/address-list/remove", "=.id=" + e[".id"]]);
      if (remover.length) {
        await fibraRouterosBatchStable(cfgLinks, remover, 20000, { ignorarItemAusente:true });
      }
    }

    let aplicados = 0;
    let erros = [];
    for (const c of clientes) {
      try {
        const ip = String(c.address).split('/')[0];
        if (net.isIP(ip)!==4) continue;
        await fibraRemoverEntradasRota(cfgLinks, c.name, ip);
        const existente = await fibraListarEntradasRota(cfgLinks, FIBRA_ROTA_LISTAS[rota], ip);
        if (!existente.some(e => String(e.address || '').split('/')[0] === ip)) {
          await routerosCommandStable(cfgLinks, [
            "/ip/firewall/address-list/add",
            "=list="+FIBRA_ROTA_LISTAS[rota],
            "=address="+ip,
            "=comment=FIBRA+ ROTA GERAL "+c.name
          ],15000);
        }

        try {
          const connResp = await routerosSend(cfgLinks.host, cfgLinks.port, cfgLinks.user, cfgLinks.pass, [[
            "/ip/firewall/connection/print",
            "=.proplist=.id",
            "?src-address="+ip
          ]],15000);
          const conns = parseRouterosRows(connResp);
          for (const conn of conns) {
            const id = conn[".id"] || conn.id;
            if (id) await routerosSend(cfgLinks.host, cfgLinks.port, cfgLinks.user, cfgLinks.pass, [[
              "/ip/firewall/connection/remove",
              "=.id="+id
            ]],15000);
          }
        } catch(e) {
          console.log("Falha limpeza conntrack", ip, e.message);
        }
        aplicados++;
      } catch(errCliente) {
        erros.push({cliente:c.name, erro:String(errCliente.message || errCliente)});
      }
    }
    return res.json({ok:true, rota, aplicados, mensagem:`${aplicados} clientes enviados para ${rota}.`});
  } catch(e){ return res.status(500).json({ok:false, erro:e.message}); }
});

/* ============================================================
   STATUS DEDICADO DO CLIENTE
   Consulta somente o MikroTik selecionado e devolve os dados
   reais usados no bloco Resumo: sessão ativa, Secret, serviço,
   VLAN/interface, profile, MTU e MRU.
============================================================ */
app.get("/api/cliente/status", async (req, res) => {
  const normalizar = (v) => String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const getCampo = (obj, nomes) => {
    for (const n of nomes) {
      if (obj && obj[n] !== undefined && obj[n] !== null && String(obj[n]).trim() !== "") {
        return String(obj[n]).trim();
      }
    }
    return "";
  };

  const servidorValido = (servidor) => {
    const s = normalizar(servidor);
    if (!s || s === "-" || s === "--") return false;
    if (s.includes("sem servidor")) return false;
    if (s.includes("selecione")) return false;
    return true;
  };

  const estaHabilitado = (row) => {
    const disabled = normalizar(getCampo(row, ["disabled"]));
    return disabled !== "yes" && disabled !== "true";
  };

  try {
    const login = String(req.query.login || "").trim();
    const servidorNome = String(req.query.servidor || "").trim();

    if (!login) {
      return res.json({
        online:false,
        motivo:"login_nao_informado",
        login:"--",
        ip:"",
        mac:"",
        uptime:"",
        interface:"",
        servico:"",
        profile:"Nenhum profile encontrado",
        mtu:"1480",
        mru:"1480",
        servidor:servidorNome
      });
    }

    if (!servidorValido(servidorNome)) {
      return res.json({
        online:false,
        motivo:"servidor_nao_selecionado",
        login,
        ip:"",
        mac:"",
        uptime:"",
        interface:"",
        servico:"",
        profile:"Nenhum profile encontrado",
        mtu:"1480",
        mru:"1480",
        servidor:servidorNome
      });
    }

    const cfg = servidorConfigClientes(servidorNome);
    if (!cfg.host || !cfg.user || !cfg.pass) {
      return res.status(500).json({
        online:false,
        erro:true,
        motivo:"mikrotik_nao_configurado",
        mensagem:"Variáveis do MikroTik não configuradas para " + (cfg.key || servidorNome),
        login,
        ip:"",
        mac:"",
        uptime:"",
        interface:"",
        servico:"",
        profile:"Nenhum profile encontrado",
        mtu:"1480",
        mru:"1480",
        servidor:cfg.key || servidorNome
      });
    }

    const consultarLinhas = async (comando, timeout = 12000) => {
      try {
        const resposta = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [comando], timeout);
        return parseRouterosRows(resposta);
      } catch (erro) {
        console.warn("Consulta complementar do Resumo falhou:", comando[0], erro.message);
        return [];
      }
    };

    const [activeRows, secretRows, pppoeInterfaceRows, pppoeServerRows] = await Promise.all([
      consultarLinhas(["/ppp/active/print", "?name=" + login]),
      consultarLinhas(["/ppp/secret/print", "?name=" + login]),
      consultarLinhas(["/interface/pppoe-server/print", "?user=" + login]),
      consultarLinhas(["/interface/pppoe-server/server/print"])
    ]);

    const loginAlvo = normalizar(login);

    const active = activeRows.find((row) =>
      normalizar(getCampo(row, ["name", "user", "usuario", "login"])) === loginAlvo
    ) || activeRows[0] || null;

    const secret = secretRows.find((row) =>
      normalizar(getCampo(row, ["name", "user", "usuario", "login"])) === loginAlvo
    ) || secretRows[0] || null;

    const pppoeInterface = pppoeInterfaceRows.find((row) => {
      const user = getCampo(row, ["user", "name", "usuario", "login"]);
      if (normalizar(user) === loginAlvo) return true;
      const nomeDinamico = normalizar(getCampo(row, ["name"]))
        .replace(/^<pppoe-/, "")
        .replace(/>$/, "");
      return nomeDinamico === loginAlvo;
    }) || pppoeInterfaceRows[0] || null;

    const servicosCandidatos = [
      getCampo(pppoeInterface, ["service-name", "service"]),
      getCampo(active, ["service-name", "service"]),
      getCampo(secret, ["service-name"])
    ].filter((v) => {
      const n = normalizar(v);
      return n && n !== "pppoe" && n !== "any";
    });

    let pppoeServer = null;
    for (const nomeServico of servicosCandidatos) {
      pppoeServer = pppoeServerRows.find((row) =>
        normalizar(getCampo(row, ["service-name", "service"])) === normalizar(nomeServico)
      );
      if (pppoeServer) break;
    }

    if (!pppoeServer) {
      const interfaceDinamica = getCampo(pppoeInterface, ["server-interface", "interface"]);
      if (interfaceDinamica) {
        pppoeServer = pppoeServerRows.find((row) =>
          normalizar(getCampo(row, ["interface"])) === normalizar(interfaceDinamica)
        ) || null;
      }
    }

    if (!pppoeServer) {
      const habilitados = pppoeServerRows.filter(estaHabilitado);
      if (habilitados.length === 1) pppoeServer = habilitados[0];
      else pppoeServer = habilitados[0] || pppoeServerRows[0] || null;
    }

    const online = Boolean(active);
    const ip = getCampo(active, ["address", "remote-address", "remote_address", "ip"]);
    const mac = getCampo(active, ["caller-id", "caller_id", "callerId", "mac-address", "mac_address", "mac"])
      || getCampo(pppoeInterface, ["caller-id", "caller_id", "callerId", "mac-address", "mac_address", "mac"]);
    const uptime = getCampo(active, ["uptime", "session-time", "session_time", "tempo"])
      || getCampo(pppoeInterface, ["uptime", "session-time", "session_time", "tempo"]);

    const profile = getCampo(secret, ["profile", "perfil", "plano"])
      || getCampo(active, ["profile", "perfil", "plano"])
      || "Nenhum profile encontrado";

    const servico = getCampo(pppoeInterface, ["service-name", "service"])
      || getCampo(pppoeServer, ["service-name", "service"])
      || getCampo(active, ["service-name", "service"])
      || getCampo(secret, ["service"])
      || "-";

    const interfaceFisica = getCampo(pppoeServer, ["interface"])
      || getCampo(pppoeInterface, ["server-interface", "interface"])
      || getCampo(active, ["interface"])
      || "-";

    const mtu = getCampo(pppoeInterface, ["actual-mtu", "actual_mtu", "mtu"])
      || getCampo(active, ["actual-mtu", "actual_mtu", "mtu"])
      || getCampo(pppoeServer, ["max-mtu", "max_mtu", "mtu"])
      || "1480";

    const mru = getCampo(pppoeInterface, ["actual-mru", "actual_mru", "mru"])
      || getCampo(active, ["actual-mru", "actual_mru", "mru"])
      || getCampo(pppoeServer, ["max-mru", "max_mru", "mru"])
      || "1480";

    const loginReal = getCampo(active, ["name", "user", "usuario", "login"])
      || getCampo(pppoeInterface, ["user", "usuario", "login"])
      || getCampo(secret, ["name", "user", "usuario", "login"])
      || login;

    return res.json({
      online,
      motivo: online ? "sessao_ppp_active_confirmada" : "login_nao_encontrado_no_ppp_active",
      login: loginReal || "--",
      ip: online ? ip : "",
      mac: online ? mac : "",
      uptime: online ? uptime : "",
      interface: interfaceFisica,
      servico,
      profile,
      mtu,
      mru,
      servidor: cfg.key || servidorNome
    });
  } catch (err) {
    console.error("Erro /api/cliente/status:", err);
    return res.status(500).json({
      online:false,
      erro:true,
      motivo:"erro_endpoint_status_cliente",
      mensagem:err.message
    });
  }
});


/* ============================================================
   DIAGNÓSTICO API / MIKROTIK
============================================================ */
app.get("/api/diagnostico/rotas", (req, res) => {
  return res.json({
    ok: true,
    rotasPrincipais: [
      "/api/servidores",
      "/api/online",
      "/api/status-mikrotik",
      "/api/cliente/status",
      "/api/mikrotik/profiles",
      "/api/mikrotik/cliente-profile",
      "/api/mikrotik/cliente-acao",
      "/api/efi/config",
      "/api/efi/status",
      "/api/efi/testar-conexao",
      "/api/efi/boletos/teste"
    ],
    apiPrincipal: "server.js",
    observacao: "Neste projeto as rotas /api ficam no server.js; o vercel.json aponta /api/* para server.js."
  });
});




app.get("/api/diagnostico/mikrotik", async (req, res) => {
  try {
    const [armandoOnline, coloniaOnline, armandoStatus, coloniaStatus] = await Promise.all([
      consultarOnlineServidor("ARMANDO"),
      consultarOnlineServidor("COLONIA"),
      consultarStatusServidor("ARMANDO"),
      consultarStatusServidor("COLONIA")
    ]);

    return res.json({
      ok: true,
      atualizadoEm: new Date().toISOString(),
      explicacao: "Se host/user/pass estiver false, falta variável no deploy. Se estiver true e houver timeout/conexão recusada, é acesso à API RouterOS.",
      armando: {
        config: diagnosticoConfigServidor("ARMANDO"),
        onlineOk: armandoOnline.ok,
        totalClientes: armandoOnline.total || 0,
        erroOnline: armandoOnline.erro || "",
        statusOk: armandoStatus.ok,
        identity: armandoStatus.identity || "",
        erroStatus: armandoStatus.erro || ""
      },
      colonia: {
        config: diagnosticoConfigServidor("COLONIA"),
        onlineOk: coloniaOnline.ok,
        totalClientes: coloniaOnline.total || 0,
        erroOnline: coloniaOnline.erro || "",
        statusOk: coloniaStatus.ok,
        identity: coloniaStatus.identity || "",
        erroStatus: coloniaStatus.erro || ""
      }
    });
  } catch (err) {
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.get("/api/servidores-debug", async (req, res) => {
  try {
    const [armandoOnline, coloniaOnline, armandoStatus, coloniaStatus] = await Promise.all([
      consultarOnlineServidor("ARMANDO"),
      consultarOnlineServidor("COLONIA"),
      consultarStatusServidor("ARMANDO"),
      consultarStatusServidor("COLONIA")
    ]);

    return res.json({
      ok: true,
      armando: {
        onlineFinal: Boolean(armandoOnline.ok || armandoStatus.ok),
        online: armandoOnline,
        status: armandoStatus,
        config: diagnosticoConfigServidor("ARMANDO")
      },
      colonia: {
        onlineFinal: Boolean(coloniaOnline.ok || coloniaStatus.ok),
        online: coloniaOnline,
        status: coloniaStatus,
        config: diagnosticoConfigServidor("COLONIA")
      }
    });
  } catch (err) {
    return res.status(500).json({ ok:false, erro:err.message });
  }
});






/* EFI BACKEND SUPABASE */
function efiBaseUrl(ambiente) {
  return String(ambiente || "").toLowerCase().includes("homolog")
    ? "https://cobrancas-h.api.efipay.com.br"
    : "https://cobrancas.api.efipay.com.br";
}

async function efiGarantirTabela() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada. Configure o Supabase no deploy.");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS efi_configuracoes (
      conta INTEGER PRIMARY KEY,
      nome_conta TEXT,
      documento TEXT,
      ambiente TEXT DEFAULT 'producao',
      client_id TEXT,
      client_secret TEXT,
      webhook TEXT,
      ativo BOOLEAN DEFAULT TRUE,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS efi_boletos_vinculos (
      id SERIAL PRIMARY KEY,
      boleto_origem TEXT,
      cliente_nome TEXT,
      cliente_documento TEXT,
      valor TEXT,
      vencimento TEXT,
      conta INTEGER DEFAULT 1,
      charge_id TEXT,
      txid TEXT,
      situacao_efi TEXT,
      linha_digitavel TEXT,
      pix_copia_cola TEXT,
      link_boleto TEXT,
      raw JSONB,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
}

function efiRowToConfig(row) {
  if (!row) return null;
  return {
    conta: Number(row.conta || 1),
    NomeConta: row.nome_conta || "",
    Documento: row.documento || "",
    Ambiente: row.ambiente || "producao",
    ClientId: row.client_id || "",
    ClientSecret: row.client_secret || "",
    Webhook: row.webhook || ""
  };
}

function efiConfigFromBody(body) {
  return {
    conta: Number(body.conta || 1),
    NomeConta: String(body.NomeConta || body.nomeConta || "").trim(),
    Documento: String(body.Documento || body.documento || "").trim(),
    Ambiente: String(body.Ambiente || body.ambiente || "producao").trim(),
    ClientId: String(body.ClientId || body.clientId || "").trim(),
    ClientSecret: String(body.ClientSecret || body.clientSecret || "").trim(),
    Webhook: String(body.Webhook || body.webhook || "").trim()
  };
}

async function efiCarregarConfig(conta = 1) {
  await efiGarantirTabela();
  const r = await pool.query(
    "SELECT * FROM efi_configuracoes WHERE conta=$1 AND ativo=true LIMIT 1",
    [Number(conta)]
  );
  return efiRowToConfig(r.rows[0]);
}

async function efiSalvarConfig(cfg) {
  await efiGarantirTabela();

  const r = await pool.query(`
    INSERT INTO efi_configuracoes
      (conta, nome_conta, documento, ambiente, client_id, client_secret, webhook, ativo, atualizado_em)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,true,NOW())
    ON CONFLICT (conta) DO UPDATE SET
      nome_conta = EXCLUDED.nome_conta,
      documento = EXCLUDED.documento,
      ambiente = EXCLUDED.ambiente,
      client_id = EXCLUDED.client_id,
      client_secret = EXCLUDED.client_secret,
      webhook = EXCLUDED.webhook,
      ativo = true,
      atualizado_em = NOW()
    RETURNING *;
  `, [
    Number(cfg.conta || 1),
    cfg.NomeConta || "",
    cfg.Documento || "",
    cfg.Ambiente || "producao",
    cfg.ClientId || "",
    cfg.ClientSecret || "",
    cfg.Webhook || ""
  ]);

  const row = r.rows[0];

  // Mantem o cadastro de contas disponivel para a aba Cobranca.
  // A conta continua tendo uma unica origem: Financeiro -> Efi.
  try {
    await pool.query(`
      INSERT INTO efi_contas
        (nome, client_id, client_secret, ambiente, status, atualizado_em)
      VALUES
        ($1,$2,$3,$4,'ativo',NOW())
      ON CONFLICT (nome) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        ambiente = EXCLUDED.ambiente,
        status = 'ativo',
        atualizado_em = NOW()
    `, [
      cfg.NomeConta || '',
      cfg.ClientId || '',
      cfg.ClientSecret || '',
      cfg.Ambiente || 'producao'
    ]);
  } catch(e) {
    console.warn('Nao foi possivel sincronizar efi_contas:', e.message);
  }

  return efiRowToConfig(row);
}

async function efiGerarToken(cfgParam = null) {
  const cfg = cfgParam || await efiCarregarConfig(1);
  const clientId = String(cfg?.ClientId || "").trim();
  const clientSecret = String(cfg?.ClientSecret || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("Client ID e Client Secret são obrigatórios.");
  }

  const basic = Buffer.from(clientId + ":" + clientSecret).toString("base64");

  const resp = await fetch(efiBaseUrl(cfg.Ambiente || "producao") + "/v1/authorize", { credentials: "include", method: "POST",
    headers: {
      "Authorization": "Basic " + basic,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ grant_type: "client_credentials" })
  });

  const text = await resp.text();
  let json = {};
  try { json = JSON.parse(text); } catch(e) { json = { raw:text }; }

  if (!resp.ok) {
    throw new Error(json.error_description || json.error || json.mensagem || text || "Falha OAuth Efí");
  }

  return json;
}

async function efiRequest(pathReq, cfg = null, options = {}) {
  const config = cfg || await efiCarregarConfig(1);
  const token = await efiGerarToken(config);

  const resp = await fetch(efiBaseUrl(config.Ambiente || "producao") + pathReq, { credentials: "include", method: options.method || "GET",
    headers: {
      "Authorization": "Bearer " + token.access_token,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await resp.text();
  let json = {};
  try { json = JSON.parse(text); } catch(e) { json = { raw:text }; }

  return { ok: resp.ok, status: resp.status, json, raw: text };
}

function efiOnlyNumbers(v) {
  return String(v || "").replace(/\D/g, "");
}

function efiDateISO(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}

function efiAddDays(iso, days) {
  const base = iso || new Date().toISOString().slice(0, 10);
  const d = new Date(base + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function efiMoneyCents(v) {
  // A API Efí recebe o valor em centavos. O painel pode enviar tanto
  // número (2.15) quanto texto brasileiro ("2,15" / "1.234,56").
  // Nunca remova o ponto de um valor que já chegou como Number,
  // pois 2.15 viraria 215 e depois 21.500 centavos.
  if (typeof v === "number") {
    return Number.isFinite(v) ? Math.round(v * 100) : 0;
  }

  let s = String(v ?? "").trim().replace(/[R$\s]/g, "");
  if (!s) return 0;

  const ultimaVirgula = s.lastIndexOf(",");
  const ultimoPonto = s.lastIndexOf(".");

  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    // O separador que aparece por último é tratado como decimal.
    if (ultimaVirgula > ultimoPonto) {
      // Ex.: 1.234,56
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Ex.: 1,234.56
      s = s.replace(/,/g, "");
    }
  } else if (ultimaVirgula >= 0) {
    // Ex.: 2,15
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // Ex.: 2.15 ou 1234.56. Mantém um único ponto decimal.
    const partes = s.split(".");
    if (partes.length > 2) {
      const decimal = partes.pop();
      s = partes.join("") + "." + decimal;
    }
  }

  s = s.replace(/[^\d.-]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function efiGet(obj, paths) {
  for (const pth of paths) {
    const parts = pth.split(".");
    let cur = obj;
    for (const p of parts) cur = cur && cur[p] !== undefined ? cur[p] : undefined;
    if (cur !== undefined && cur !== null && String(cur).trim() !== "") return cur;
  }
  return "";
}

function efiExtractArray(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.charges)) return json.charges;
  if (Array.isArray(json.transactions)) return json.transactions;
  if (json.data && Array.isArray(json.data.items)) return json.data.items;
  if (json.data && Array.isArray(json.data.charges)) return json.data.charges;
  if (json.data && Array.isArray(json.data.transactions)) return json.data.transactions;
  return [];
}

function efiStatusLabel(s) {
  const status = String(s || "").toLowerCase();
  if (status.includes("paid") || status.includes("pago") || status.includes("settled")) return "Pago";
  if (status.includes("wait") || status.includes("pend") || status.includes("new") || status.includes("unpaid")) return "Aguardando pagamento";
  if (status.includes("cancel")) return "Cancelado";
  if (status.includes("expire") || status.includes("venc")) return "Vencido";
  return s || "Registrado na Efí";
}

function efiExtractChargeDetails(json) {
  const data = json && (json.data || json);
  const linha = efiGet(data, [
    "barcode", "digitable_line", "linha_digitavel",
    "payment.banking_billet.barcode",
    "payment.banking_billet.digitable_line",
    "banking_billet.barcode",
    "banking_billet.digitable_line"
  ]);

  const pix = efiGet(data, [
    "pixCopiaECola", "pix_copia_e_cola",
    "pix.qrcode", "pix.qr_code", "pix.copy_paste",
    "payment.pix.qrcode", "payment.pix.copy_paste",
    "qrcode", "qr_code"
  ]);

  const link = efiGet(data, [
    "pdf.charge", "pdf.carnet", "payment_url", "link", "url",
    "payment.banking_billet.link", "banking_billet.link"
  ]);

  const status = efiGet(data, ["status", "situacao"]);

  return {
    situacao_efi: efiStatusLabel(status),
    linha_digitavel: String(linha || ""),
    pix_copia_cola: String(pix || ""),
    link_boleto: String(link || ""),
    charge_id: String(efiGet(data, ["charge_id", "id", "transaction_id", "custom_id"]) || ""),
    txid: String(efiGet(data, ["txid", "pix.txid"]) || ""),
    raw: data
  };
}

function efiScoreCharge(item, alvo) {
  let pontos = 0;

  const id = String(efiGet(item, ["charge_id", "id", "transaction_id", "custom_id", "numero"]) || "").trim();
  const nome = String(efiGet(item, ["customer.name", "customer", "payer.name", "name", "cliente"]) || "").toLowerCase();
  const doc = efiOnlyNumbers(efiGet(item, ["customer.cpf", "customer.cnpj", "cpf", "cnpj", "cpf_cnpj"]));
  const venc = efiDateISO(efiGet(item, ["expire_at", "due_date", "vencimento", "payment.banking_billet.expire_at", "banking_billet.expire_at"]));
  const valor = Number(efiGet(item, ["total", "value", "amount", "payment.banking_billet.value", "banking_billet.value"]) || 0);

  const alvoId = String(alvo.numero || alvo.charge_id || alvo.chargeId || "").trim();
  const alvoNome = String(alvo.cliente || alvo.cliente_nome || "").toLowerCase();
  const alvoDoc = efiOnlyNumbers(alvo.cpf || alvo.cpf_cnpj || alvo.documento || "");
  const alvoVenc = efiDateISO(alvo.vencimento || "");
  const alvoValor = efiMoneyCents(alvo.valor || alvo.valorPago || "");

  if (alvoId && id === alvoId) pontos += 100;
  if (alvoDoc && doc && doc === alvoDoc) pontos += 60;
  if (alvoNome && nome && (nome.includes(alvoNome) || alvoNome.includes(nome))) pontos += 45;
  if (alvoVenc && venc && venc === alvoVenc) pontos += 35;
  if (alvoValor && valor) {
    const cent = valor > 100000 ? Math.round(valor) : Math.round(valor * 100);
    if (Math.abs(cent - alvoValor) <= 2) pontos += 35;
  }
  return pontos;
}


async function efiSalvarVinculoBoleto(dados, retorno) {
  await efiGarantirTabela();

  const ids = efiExtrairIdsImportado(dados);
  const chargeId = String(retorno.charge_id || ids.identificacao || "");
  const carneId = String(ids.carne || "");

  await pool.query(`
    INSERT INTO efi_boletos_vinculos
      (boleto_origem, cliente_nome, cliente_documento, valor, vencimento, conta,
       charge_id, txid, situacao_efi, linha_digitavel, pix_copia_cola, link_boleto,
       efi_charge_id, efi_carne_id, identificacao_receitanet, raw, atualizado_em)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
  `, [
    String(dados.numero || dados.boleto_origem || dados.id || ids.identificacao || ""),
    String(dados.cliente || dados.cliente_nome || ""),
    efiOnlyNumbers(dados.cpf || dados.cpf_cnpj || dados.documento || ""),
    String(dados.valor || dados.valorPago || ""),
    String(dados.vencimento || ""),
    Number(dados.conta || 1),
    chargeId,
    String(retorno.txid || ""),
    String(retorno.situacao_efi || ""),
    String(retorno.linha_digitavel || ""),
    String(retorno.pix_copia_cola || ""),
    String(retorno.link_boleto || ""),
    chargeId,
    carneId,
    String(ids.identificacao || ""),
    retorno.raw ? JSON.stringify(retorno.raw) : null
  ]);
}


app.get("/api/efi/config", async (req, res) => {
  try {
    const conta = Number(req.query.conta || 1);
    const cfg = await efiCarregarConfig(conta);
    return res.json({
      ok: true,
      conta,
      config: cfg || { conta, NomeConta:"", Documento:"", Ambiente:"producao", ClientId:"", ClientSecret:"", Webhook:"" }
    });
  } catch (err) {
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.post("/api/efi/salvar-config", async (req, res) => {
  try {
    const cfg = efiConfigFromBody(req.body || {});
    if (!cfg.NomeConta) return res.status(400).json({ ok:false, erro:"Nome da conta Efí é obrigatório." });
    if (!cfg.Documento) return res.status(400).json({ ok:false, erro:"CPF/CNPJ da conta Efí é obrigatório." });

    const salvo = await efiSalvarConfig(cfg);
    return res.json({ ok:true, conta:salvo.conta, mensagem:"Configuração Efí salva no Supabase.", config:salvo });
  } catch (err) {
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.post("/api/efi/testar-conexao", async (req, res) => {
  try {
    const cfg = efiConfigFromBody(req.body || {});
    if (!cfg.ClientId || !cfg.ClientSecret) return res.status(400).json({ ok:false, erro:"Client ID e Client Secret são obrigatórios." });

    const token = await efiGerarToken(cfg);
    const salvo = await efiSalvarConfig(cfg);

    return res.json({
      ok:true,
      conta:salvo.conta,
      mensagem:"Conexão Efí OK. Configuração salva no Supabase.",
      token_type:token.token_type || "Bearer",
      expires_in:token.expires_in || null,
      config:salvo
    });
  } catch (err) {
    console.error("Erro /api/efi/testar-conexao:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.get("/api/efi/status", async (req, res) => {
  try {
    const cfg = await efiCarregarConfig(1);
    const integrada = Boolean(cfg && cfg.ClientId && cfg.ClientSecret);
    return res.json({
      ok:true,
      integrada,
      conta: integrada ? { conta:cfg.conta, nomeConta:cfg.NomeConta || "Conta Efí 1", documento:cfg.Documento || "", ambiente:cfg.Ambiente || "producao" } : null
    });
  } catch (err) {
    return res.status(500).json({ ok:false, integrada:false, erro:err.message });
  }
});

app.get("/api/efi/status-online", async (req, res) => {
  try {
    const conta = Number(req.query.conta || 1);
    const cfg = await efiCarregarConfig(conta);

    if (!cfg || !cfg.ClientId || !cfg.ClientSecret) {
      return res.json({ ok:true, online:false, conta, motivo:"Conta Efí não configurada." });
    }

    const token = await efiGerarToken(cfg);

    return res.json({
      ok:true,
      online:true,
      conta,
      mensagem:"Efí Online",
      ambiente:cfg.Ambiente || "producao",
      nomeConta:cfg.NomeConta || ("Conta Efí " + conta),
      expires_in:token.expires_in || null,
      token_type:token.token_type || "Bearer"
    });
  } catch (err) {
    return res.json({ ok:true, online:false, conta:Number(req.query.conta || 1), motivo:err.message });
  }
});

app.get("/api/efi/boletos/teste", async (req, res) => {
  try {
    const cfg = await efiCarregarConfig(1);
    const token = await efiGerarToken(cfg);
    return res.json({
      ok:true,
      mensagem:"OAuth Efí OK para Conta 1.",
      observacao:"Configuração carregada do Supabase.",
      token_type:token.token_type || "Bearer",
      expires_in:token.expires_in || null
    });
  } catch (err) {
    console.error("Erro /api/efi/boletos/teste:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});



function efiExtrairIdsImportado(body) {
  const id = String(
    body.identificacao ||
    body.Identificacao ||
    body["Identificação"] ||
    body.identificacao_receitanet ||
    body.efi_charge_id ||
    body.charge_id ||
    body.chargeId ||
    body.transaction_id ||
    body.numero ||
    body.id ||
    ""
  ).trim();

  const carne = String(
    body.carne ||
    body.Carne ||
    body["Carnê"] ||
    body.carne_id ||
    body.efi_carne_id ||
    body.carnet_id ||
    ""
  ).trim();

  return { identificacao: id, carne };
}



app.post("/api/efi/boleto-importado/vincular", async (req, res) => {
  try {
    const body = req.body || {};
    const ids = efiExtrairIdsImportado(body);
    if (!ids.identificacao) {
      return res.status(400).json({ ok:false, erro:"Identificação da Efí não informada." });
    }

    const conta = Number(body.conta || 1);
    const cfg = await efiCarregarConfig(conta);
    if (!cfg || !cfg.ClientId || !cfg.ClientSecret) {
      return res.status(400).json({ ok:false, erro:"Conta Efí não configurada." });
    }

    const tentativas = [
      "/v1/charge/" + encodeURIComponent(ids.identificacao),
      "/v1/charge/" + encodeURIComponent(ids.identificacao) + "/detail",
      "/v1/transaction/" + encodeURIComponent(ids.identificacao),
      "/v1/transactions/" + encodeURIComponent(ids.identificacao)
    ];

    if (ids.carne) {
      tentativas.push("/v1/carnet/" + encodeURIComponent(ids.carne));
      tentativas.push("/v1/carnet/" + encodeURIComponent(ids.carne) + "/detail");
      tentativas.push("/v1/carnet/" + encodeURIComponent(ids.carne) + "/parcel/" + encodeURIComponent(ids.identificacao));
    }

    let ultimoErro = null;

    for (const pathReq of tentativas) {
      try {
        const r = await efiRequest(pathReq, cfg);
        if (r.ok) {
          const detalhes = efiExtractChargeDetails(r.json);
          detalhes.charge_id = detalhes.charge_id || ids.identificacao;
          await efiSalvarVinculoBoleto(body, detalhes);
          return res.json({ ok:true, encontrado:true, fonte:pathReq, ...detalhes });
        }
        ultimoErro = r.json;
      } catch (e) {
        ultimoErro = e.message;
      }
    }

    return res.json({
      ok:true,
      encontrado:false,
      situacao_efi:"Integrado na Efí - identificação não localizada",
      identificacao: ids.identificacao,
      carne: ids.carne,
      ultimoErro
    });
  } catch (err) {
    console.error("Erro /api/efi/boleto-importado/vincular:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.post("/api/efi/boleto-importado/consultar", async (req, res) => {
  const body = req.body || {};
  try {

    const chargeExistente = String(
      body.efi_charge_id ||
      body.efiChargeId ||
      body.charge_id ||
      ""
    ).trim();

    if (chargeExistente) {
      const salvo = await pool.query(`
        SELECT *
        FROM boletos
        WHERE efi_charge_id=$1 OR numero=$2
        ORDER BY atualizado_em DESC NULLS LAST
        LIMIT 1
      `, [chargeExistente, String(body.numero || "")]);

      if (salvo.rows[0]) {
        const row = salvo.rows[0];
        const dados = row.dados || {};
        return res.json({
          ok:true,
          encontrado:true,
          preservado:true,
          charge_id: row.efi_charge_id || chargeExistente,
          situacao_efi: row.efi_status || dados.efiStatus || "Aguardando pagamento",
          linha_digitavel: row.linha_digitavel || dados.linhaDigitavel || "",
          pix_copia_cola: row.pix || dados.pix || dados.codigoPix || dados.pixCopiaCola || "",
          link_boleto: row.link_pdf || dados.linkPdf || dados.pdf || ""
        });
      }
    }
    
    const conta = Number(body.conta || 1);
    const cfg = await efiCarregarConfig(conta);

    if (!cfg || !cfg.ClientId || !cfg.ClientSecret) {
      return res.status(400).json({ ok:false, erro:"Conta Efí não configurada." });
    }

    const idsImportado = efiExtrairIdsImportado(body);
    const numero = idsImportado.identificacao;
    const emissao = efiDateISO(body.emissao || "");
    const vencimento = efiDateISO(body.vencimento || "");

    if (numero) {
      const tentativas = [
        "/v1/charge/" + encodeURIComponent(numero),
        "/v1/charge/" + encodeURIComponent(numero) + "/detail",
        "/v1/transaction/" + encodeURIComponent(numero),
        "/v1/transactions/" + encodeURIComponent(numero)
      ];

      if (idsImportado.carne) {
        tentativas.push("/v1/carnet/" + encodeURIComponent(idsImportado.carne));
        tentativas.push("/v1/carnet/" + encodeURIComponent(idsImportado.carne) + "/detail");
        tentativas.push("/v1/carnet/" + encodeURIComponent(idsImportado.carne) + "/parcel/" + encodeURIComponent(numero));
      }

      for (const pathReq of tentativas) {
        try {
          const r = await efiRequest(pathReq, cfg);
          if (r.ok) {
            const detalhes = efiExtractChargeDetails(r.json);
            await efiSalvarVinculoBoleto(body, detalhes);
            return res.json({ ok:true, encontrado:true, fonte:pathReq, ...detalhes });
          }
        } catch(e) {}
      }
    }

    const datas = [];
    if (emissao) datas.push(emissao);
    if (vencimento) datas.push(vencimento);
    if (!datas.length) datas.push(new Date().toISOString().slice(0,10));

    let melhor = null;
    let melhorScore = 0;
    let ultimoErro = null;

    for (const d of datas) {
      const begin = efiAddDays(d, -180);
      const end = efiAddDays(d, 180);
      const paths = [
        `/v1/charges?begin_date=${begin}&end_date=${end}`,
        `/v1/charges?begin_date=${begin}&end_date=${end}&status=all`,
        `/v1/transactions?begin_date=${begin}&end_date=${end}`,
        `/v1/transactions?begin_date=${begin}&end_date=${end}&status=all`
      ];

      for (const pth of paths) {
        try {
          const r = await efiRequest(pth, cfg);
          if (!r.ok) {
            ultimoErro = r.json;
            continue;
          }

          const lista = efiExtractArray(r.json);
          for (const item of lista) {
            const score = efiScoreCharge(item, body);
            if (score > melhorScore) {
              melhorScore = score;
              melhor = item;
            }
          }
        } catch(e) {
          ultimoErro = e.message;
        }
      }
    }

    if (melhor && melhorScore >= 25) {
      const id = efiGet(melhor, ["charge_id", "id", "transaction_id"]);
      if (id) {
        const detalhePaths = [
          "/v1/charge/" + encodeURIComponent(id),
          "/v1/charge/" + encodeURIComponent(id) + "/detail",
          "/v1/transaction/" + encodeURIComponent(id),
          "/v1/transactions/" + encodeURIComponent(id)
        ];

        for (const pth of detalhePaths) {
          try {
            const d = await efiRequest(pth, cfg);
            if (d.ok) {
              const detalhes = efiExtractChargeDetails(d.json);
              await efiSalvarVinculoBoleto(body, detalhes);
              return res.json({ ok:true, encontrado:true, fonte:"busca+detalhe", score:melhorScore, ...detalhes });
            }
          } catch(e) {}
        }
      }

      const detalhes = efiExtractChargeDetails(melhor);
      await efiSalvarVinculoBoleto(body, detalhes);
      return res.json({ ok:true, encontrado:true, fonte:"busca", score:melhorScore, ...detalhes });
    }

    return res.json({
      ok:true,
      encontrado:false,
      situacao_efi:"Integrado na Efí - boleto não localizado",
      linha_digitavel:"",
      pix_copia_cola:"",
      link_boleto:"",
      debug:{ numero, emissao, vencimento, cliente:body.cliente || "", valor:body.valor || body.valorPago || "", ultimoErro }
    });
  } catch (err) {
    console.error("Erro /api/efi/boleto-importado/consultar:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});




function efiBoletoRowToAlvo(row) {
  return {
    numero: row.numero || "",
    cliente: row.cliente_nome || row.nome || "",
    cliente_nome: row.cliente_nome || row.nome || "",
    cpf_cnpj: row.cpf_cnpj || row.cpf || "",
    documento: row.cpf_cnpj || row.cpf || "",
    valor: row.valor || row.total || "",
    vencimento: row.vencimento || "",
    identificacao: row.identificacao_carne || "",
    conta: 1
  };
}


async function efiBuscarCobrancasIntervalo(cfg, begin, end) {
  // A Efí exige charge_type + begin_date + end_date para listar cobranças.
  // Consultamos boleto avulso e carnê, pois boletos do ReceitaNet podem vir de ambos.
  const paths = [
    `/v1/charges?charge_type=banking_billet&begin_date=${begin}&end_date=${end}`,
    `/v1/charges?charge_type=carnet&begin_date=${begin}&end_date=${end}`
  ];

  const statusList = ["waiting", "unpaid", "paid", "settled", "canceled", "expired", "link"];

  for (const status of statusList) {
    paths.push(`/v1/charges?charge_type=banking_billet&begin_date=${begin}&end_date=${end}&status=${status}`);
    paths.push(`/v1/charges?charge_type=carnet&begin_date=${begin}&end_date=${end}&status=${status}`);
  }

  const todos = [];
  const erros = [];

  for (const pth of paths) {
    try {
      const r = await efiRequest(pth, cfg);
      if (r.ok) {
        const arr = efiExtractArray(r.json);
        if (Array.isArray(arr)) todos.push(...arr);
      } else {
        erros.push({ endpoint: pth, status: r.status, erro: r.json });
      }
    } catch (e) {
      erros.push({ endpoint: pth, erro: e.message });
    }
  }

  const mapa = new Map();
  for (const item of todos) {
    const id = String(efiGet(item, ["charge_id", "id", "transaction_id", "custom_id"]) || JSON.stringify(item).slice(0, 120));
    if (!mapa.has(id)) mapa.set(id, item);
  }

  return { lista: Array.from(mapa.values()), erros, endpointsConsultados: paths.length };
}

async function efiDetalharPorId(cfg, id) {
  const detalhePaths = [
    "/v1/charge/" + encodeURIComponent(id),
    "/v1/charge/" + encodeURIComponent(id) + "/detail",
    "/v1/transaction/" + encodeURIComponent(id),
    "/v1/transactions/" + encodeURIComponent(id)
  ];

  for (const pth of detalhePaths) {
    try {
      const d = await efiRequest(pth, cfg);
      if (d.ok) {
        const detalhes = efiExtractChargeDetails(d.json);
        detalhes.charge_id = detalhes.charge_id || String(id);
        return { ok: true, fonte: pth, detalhes };
      }
    } catch (e) {}
  }

  return { ok: false };
}

async function efiAtualizarBoletoSupabase(row, detalhes, conta, contaNome) {
  await pool.query(`
    UPDATE boletos SET
      efi_charge_id=$1,
      efi_status=$2,
      efi_conta_id=$3,
      efi_conta_nome=$4,
      linha_digitavel=$5,
      pix=$6,
      link_pdf=$7,
      dados = COALESCE(dados, '{}'::jsonb) || $8::jsonb,
      atualizado_em=NOW()
    WHERE numero=$9
  `, [
    detalhes.charge_id || "",
    detalhes.situacao_efi || "",
    Number(conta || 1),
    contaNome || "",
    detalhes.linha_digitavel || "",
    detalhes.pix_copia_cola || "",
    detalhes.link_boleto || "",
    JSON.stringify({
      efiChargeId: detalhes.charge_id || "",
      efiStatus: detalhes.situacao_efi || "",
      linhaDigitavel: detalhes.linha_digitavel || "",
      pix: detalhes.pix_copia_cola || "",
      linkPdf: detalhes.link_boleto || "",
      efiSincronizadoEm: new Date().toISOString()
    }),
    row.numero
  ]);
}

app.post("/api/efi/sincronizar-importados", async (req, res) => {
  try {
    await efiGarantirTabela();

    const body = req.body || {};
    const conta = Number(body.conta || 1);
    const limite = Math.min(Number(body.limite || 100), 300);
    const cfg = await efiCarregarConfig(conta);

    if (!cfg || !cfg.ClientId || !cfg.ClientSecret) {
      return res.status(400).json({ ok:false, erro:"Conta Efí não configurada." });
    }

    await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_charge_id TEXT;");
    await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_status TEXT;");
    // efi_conta_id pode existir como UUID no Supabase; não alteramos nem gravamos número 1 nele.
    await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_conta_nome TEXT;");
    await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS linha_digitavel TEXT;");
    await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS pix TEXT;");
    await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS link_pdf TEXT;");

    let boletos = [];
    try {
      const r = await pool.query(`
        SELECT * FROM boletos
        WHERE (efi_charge_id IS NULL OR efi_charge_id = '')
          AND (
            origem ILIKE '%ReceitaNet%'
            OR descricao ILIKE '%ReceitaNet%'
            OR identificacao_carne IS NOT NULL
          )
        ORDER BY vencimento DESC NULLS LAST
        LIMIT $1
      `, [limite]);
      boletos = r.rows || [];
    } catch (e) {
      const r = await pool.query(`
        SELECT * FROM boletos
        WHERE (efi_charge_id IS NULL OR efi_charge_id = '')
        ORDER BY vencimento DESC NULLS LAST
        LIMIT $1
      `, [limite]);
      boletos = r.rows || [];
    }

    if (!boletos.length) {
      return res.json({ ok:true, total:0, vinculados:0, naoEncontrados:0, mensagem:"Nenhum boleto importado pendente de vínculo foi encontrado." });
    }

    const datas = boletos.map(b => efiDateISO(b.vencimento)).filter(Boolean).sort();
    const begin = efiAddDays(datas[0] || new Date().toISOString().slice(0,10), -180);
    const end = efiAddDays(datas[datas.length - 1] || new Date().toISOString().slice(0,10), 180);

    const busca = await efiBuscarCobrancasIntervalo(cfg, begin, end);
    const cobrancas = busca.lista || [];

    let vinculados = 0;
    const naoEncontrados = [];
    const encontrados = [];

    for (const b of boletos) {
      const alvo = efiBoletoRowToAlvo(b);

      let melhor = null;
      let melhorScore = 0;
      let segundoScore = 0;

      for (const c of cobrancas) {
        const score = efiScoreCharge(c, alvo);
        if (score > melhorScore) {
          segundoScore = melhorScore;
          melhorScore = score;
          melhor = c;
        } else if (score > segundoScore) {
          segundoScore = score;
        }
      }

      // Exige correspondência forte e evita empate perigoso.
      if (melhor && melhorScore >= 70 && melhorScore > segundoScore) {
        const id = String(efiGet(melhor, ["charge_id", "id", "transaction_id", "custom_id"]) || "");
        let detalhes = efiExtractChargeDetails(melhor);
        if (id) {
          const det = await efiDetalharPorId(cfg, id);
          if (det.ok) detalhes = det.detalhes;
          detalhes.charge_id = detalhes.charge_id || id;
        }

        await efiAtualizarBoletoSupabase(b, detalhes, conta, cfg.NomeConta || ("Conta Efí " + conta));
        await efiSalvarVinculoBoleto(alvo, detalhes);

        vinculados++;
        encontrados.push({
          numero: b.numero,
          cliente: b.cliente_nome,
          valor: b.valor,
          vencimento: b.vencimento,
          charge_id: detalhes.charge_id,
          score: melhorScore
        });
      } else {
        naoEncontrados.push({
          numero: b.numero,
          cliente: b.cliente_nome,
          valor: b.valor,
          vencimento: b.vencimento,
          motivo: melhor ? `Sem correspondência segura. Melhor score ${melhorScore}, segundo ${segundoScore}` : "Nenhuma cobrança candidata encontrada"
        });
      }
    }

    return res.json({
      ok:true,
      conta,
      periodo:{ begin, end },
      total: boletos.length,
      cobrancasEfi: cobrancas.length,
      endpointsConsultados: busca.endpointsConsultados || 0,
      vinculados,
      naoEncontrados: naoEncontrados.length,
      encontrados,
      pendentes: naoEncontrados.slice(0, 30),
      errosBusca: busca.erros || []
    });
  } catch (err) {
    console.error("Erro /api/efi/sincronizar-importados:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});



/* EFI GERAR BOLETOS PELO PAINEL */
function efiFormatDateBRorISO(v) {
  const iso = efiDateISO(v);
  return iso || new Date().toISOString().slice(0, 10);
}

function efiPessoaFisicaOuJuridica(documento, nome) {
  const doc = efiOnlyNumbers(documento);
  if (doc.length > 11) {
    return { juridical_person: { corporate_name: nome || "Cliente", cnpj: doc } };
  }
  return { name: nome || "Cliente", cpf: doc };
}

function efiBuildBilletPayload(body) {
  const valor = efiMoneyCents(body.valor || body.total || 0);
  const nome = String(body.nome || body.cliente || body.cliente_nome || "Cliente").trim();
  const documento = efiOnlyNumbers(body.cpfCnpj || body.cpf_cnpj || body.cpf || body.cnpj || body.documento || body.doc || body.clienteCpf || body.clienteCnpj || "");
  const telefone = efiOnlyNumbers(body.telefone || body.celular || "");
  const email = String(body.email || "").trim();
  const descricao = String(body.descricao || body.categoria || "Mensalidade Fibra+").trim();
  const vencimento = efiFormatDateBRorISO(body.vencimento || body.dueDate || body.due_date);

  if (!valor || valor <= 0) throw new Error("Valor do boleto inválido.");
  if (!documento) throw new Error("CPF/CNPJ do cliente é obrigatório para gerar boleto Efí.");

  const customer = {
    ...efiPessoaFisicaOuJuridica(documento, nome)
  };
  if (telefone) customer.phone_number = telefone;
  if (email) customer.email = email;

  return {
    items: [{
      name: descricao || "Mensalidade",
      value: valor,
      amount: 1
    }],
    payment: {
      banking_billet: {
        expire_at: vencimento,
        customer,
        message: String(body.mensagem || "Boleto gerado pelo Fibra+ Hub").slice(0, 80)
      }
    },
    metadata: {
      custom_id: String(body.numero || body.login || Date.now()),
      notification_url: String(body.webhook || "")
    }
  };
}





function efiExtrairPixOficial(payload) {
  if (!payload) return "";

  const caminhos = [
    "data.pix.qrcode",
    "data.payment.banking_billet.pix.qrcode",
    "data.payment.banking_billet.pix.copy_paste",
    "data.pix.copy_paste",
    "data.pix.copia_cola",
    "pix.qrcode",
    "payment.banking_billet.pix.qrcode",
    "payment.banking_billet.pix.copy_paste"
  ];

  for (const caminho of caminhos) {
    const valor = efiGet(payload, [caminho]);
    if (valor !== undefined && valor !== null && String(valor).trim() !== "") {
      return String(valor).trim();
    }
  }

  return "";
}


async function efiBuscarPixDaCobranca(cfg, chargeId) {
  if (!chargeId) return { pix: "", raw: null, fonte: "" };

  const paths = [
    "/v1/charge/" + encodeURIComponent(chargeId),
    "/v1/charge/" + encodeURIComponent(chargeId) + "/detail"
  ];

  for (const pth of paths) {
    try {
      const r = await efiRequest(pth, cfg);
      if (!r.ok) continue;

      const pix = efiExtrairPixOficial(r.json);
      if (pix) return { pix, raw: r.json, fonte: pth };
    } catch (e) {}
  }

  return { pix: "", raw: null, fonte: "" };
}



async function efiCriarBoletoOneStep(body, conta = 1) {
  const cfg = await efiCarregarConfig(conta);
  if (!cfg || !cfg.ClientId || !cfg.ClientSecret) {
    throw new Error("Conta Efí não configurada.");
  }

  const payload = efiBuildBilletPayload(body);

  if (!payload.metadata.notification_url) {
    const webhookConfigurado = autoTexto(cfg.Webhook || cfg.webhook);
    const basePublica = autoBasePublica();
    payload.metadata.notification_url =
      webhookConfigurado ||
      (basePublica ? basePublica + "/api/efi/webhook?conta=" + conta : "");
  }

  if (!payload.metadata.notification_url) delete payload.metadata.notification_url;

  // Fluxo correto da API Cobranças:
  // 1) cria a cobrança em /v1/charge
  // 2) registra/paga como boleto em /v1/charge/:id/pay
  // 3) consulta detalhes para buscar linha digitável, link e status
  const criar = await efiRequest("/v1/charge", cfg, {
    method: "POST",
    body: {
      items: payload.items,
      metadata: payload.metadata
    }
  });

  if (!criar.ok) {
    throw new Error("Efí não criou a cobrança: " + JSON.stringify(criar.json || criar.raw).slice(0, 700));
  }

  const chargeId = String(efiGet(criar.json, ["data.charge_id", "charge_id", "data.id", "id"]) || "");
  if (!chargeId) {
    throw new Error("Efí criou a cobrança, mas não retornou charge_id: " + JSON.stringify(criar.json).slice(0, 700));
  }

  const pagar = await efiRequest("/v1/charge/" + encodeURIComponent(chargeId) + "/pay", cfg, {
    method: "POST",
    body: {
      payment: payload.payment
    }
  });

  if (!pagar.ok) {
    throw new Error("Efí não registrou o boleto: " + JSON.stringify(pagar.json || pagar.raw).slice(0, 700));
  }

  const pixLogoPay = efiExtrairPixOficial(pagar.json);

  let detalhes = efiExtractChargeDetails(pagar.json);
  if (pixLogoPay) detalhes.pix_copia_cola = pixLogoPay;
  detalhes.charge_id = detalhes.charge_id || chargeId;

  const det = await efiDetalharPorId(cfg, chargeId);
  if (det.ok) {
    const pixAntesDetalhe = detalhes.pix_copia_cola || "";
    detalhes = {
      ...detalhes,
      ...det.detalhes,
      charge_id: chargeId
    };
    if (!detalhes.pix_copia_cola && pixAntesDetalhe) {
      detalhes.pix_copia_cola = pixAntesDetalhe;
    }
  }

  if (!detalhes.pix_copia_cola) {
    const pixRet = await efiBuscarPixDaCobranca(cfg, chargeId);
    if (pixRet.pix) detalhes.pix_copia_cola = pixRet.pix;
  }

  if (!detalhes.pix_copia_cola && pixLogoPay) {
    detalhes.pix_copia_cola = pixLogoPay;
  }

  return {
    cfg,
    detalhes,
    raw: {
      criar: criar.json,
      pagar: pagar.json
    }
  };
}



async function salvarBoletoGeradoSupabase(body, detalhes, conta, nomeConta) {
  await efiGarantirTabela();

  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS numero TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS cliente_id TEXT;");
  await pool.query("ALTER TABLE boletos ALTER COLUMN cliente_id TYPE TEXT USING cliente_id::text;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS cliente_login TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS cliente_nome TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS categoria TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS descricao TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS emissao DATE;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS vencimento DATE;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS valor NUMERIC DEFAULT 0;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS valor_pago NUMERIC DEFAULT 0;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente';");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS linha_digitavel TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS pix TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS link_pdf TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_charge_id TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_status TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_conta_nome TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS dados JSONB;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS origem TEXT;");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT NOW();");
  await pool.query("ALTER TABLE boletos ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT NOW();");

  const chargeId = String(detalhes.charge_id || "");
  const numero = String(body.numero || chargeId || Date.now());
  const valor = Number(body.valor || body.total || 0) || 0;
  const login = String(body.login || body.loginPppoe || body.clienteLogin || body.usuario || "").trim();
  let clienteId = String(body.clienteId || body.cliente_id || body.idCliente || "").trim();
  if (!clienteId && login) {
    const clienteExato = await pool.query(`SELECT id FROM clientes WHERE login_pppoe=$1 OR dados->>'loginPppoe'=$1 OR dados->>'login'=$1 ORDER BY id DESC LIMIT 1`, [login]);
    clienteId = String(clienteExato.rows[0]?.id || "").trim();
  }
  if (!clienteId) throw new Error("Não foi possível identificar o ponto do cliente. Abra o cadastro correto antes de gerar o boleto.");
  const nome = String(body.nome || body.cliente || body.cliente_nome || "");
  const cpf = String(body.cpfCnpj || body.cpf || body.cpf_cnpj || body.documento || "");
  const vencimento = efiDateISO(body.vencimento || body.dueDate || body.due_date) || null;
  const emissao = efiDateISO(body.emissao || new Date().toISOString().slice(0, 10)) || new Date().toISOString().slice(0,10);

  const dados = {
    ...body,
    numero,
    clienteId,
    cliente_id: clienteId,
    login,
    loginPppoe: login,
    clienteLogin: login,
    nome,
    cliente: nome,
    cpfCnpj: cpf,
    cpf,
    valor,
    total: valor,
    vencimento,
    emissao,
    status: "pendente",
    efiChargeId: chargeId,
    efiStatus: detalhes.situacao_efi || "Registrado na Efí",
    contaEfi: Number(conta || 1),
    contaEfiNome: nomeConta || "",
    linhaDigitavel: detalhes.linha_digitavel || "",
    pix: detalhes.pix_copia_cola || "",
    codigoPix: detalhes.pix_copia_cola || "",
    pixCopiaCola: detalhes.pix_copia_cola || "",
    linkPdf: detalhes.link_boleto || "",
    pdf: detalhes.link_boleto || "",
    segundaVia: detalhes.link_boleto || "",
    origem: "Painel Fibra+ Hub Efí",
    atualizadoEm: new Date().toISOString()
  };

  // Primeiro tenta atualizar por efi_charge_id/numero. Se não atualizar, insere.
  let r = await pool.query(`
    UPDATE boletos SET
      numero=$1,
      cliente_id=$18,
      cliente_login=$2,
      cliente_nome=$3,
      cpf_cnpj=$4,
      categoria=$5,
      descricao=$6,
      emissao=$7,
      vencimento=$8,
      valor=$9,
      total=$10,
      valor_pago=COALESCE(valor_pago,0),
      status='pendente',
      efi_charge_id=$14,
      efi_status=COALESCE(NULLIF($15,''), efi_status),
      efi_conta_nome=COALESCE(NULLIF($16,''), efi_conta_nome),
      linha_digitavel=COALESCE(NULLIF($11,''), linha_digitavel),
      pix=COALESCE(NULLIF($12,''), pix),
      link_pdf=COALESCE(NULLIF($13,''), link_pdf),
      dados=COALESCE(dados,'{}'::jsonb) || $17::jsonb,
      origem='Painel Fibra+ Hub Efí',
      atualizado_em=NOW()
    WHERE
      ($14 <> '' AND efi_charge_id=$14)
      OR numero=$1
    RETURNING *;
  `, [
    numero,
    login,
    nome,
    cpf,
    body.categoria || "Mensalidade",
    body.descricao || "Boleto gerado pela Efí",
    emissao,
    vencimento,
    valor,
    valor,
    detalhes.linha_digitavel || "",
    detalhes.pix_copia_cola || "",
    detalhes.link_boleto || "",
    chargeId,
    detalhes.situacao_efi || "Registrado na Efí",
    nomeConta || "",
    JSON.stringify(dados),
    clienteId
  ]);

  if (!r.rows[0]) {
    r = await pool.query(`
      INSERT INTO boletos
        (numero, cliente_id, cliente_login, cliente_nome, cpf_cnpj, categoria, descricao, emissao, vencimento,
         valor, total, valor_pago, status, linha_digitavel, pix, link_pdf,
         efi_charge_id, efi_status, efi_conta_nome, dados, origem, atualizado_em, criado_em)
      VALUES
        ($1,$18,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'pendente',$11,$12,$13,$14,$15,$16,$17,'Painel Fibra+ Hub Efí',NOW(),NOW())
      RETURNING *;
    `, [
      numero,
      login,
      nome,
      cpf,
      body.categoria || "Mensalidade",
      body.descricao || "Boleto gerado pela Efí",
      emissao,
      vencimento,
      valor,
      valor,
      detalhes.linha_digitavel || "",
      detalhes.pix_copia_cola || "",
      detalhes.link_boleto || "",
      chargeId,
      detalhes.situacao_efi || "Registrado na Efí",
      nomeConta || "",
      JSON.stringify(dados),
      clienteId
    ]);
  }

  await efiSalvarVinculoBoleto(body, detalhes);
  return r.rows[0];
}



function financeiroTextoNormalizado(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function financeiroStatusCancelado(status) {
  const st = financeiroTextoNormalizado(status);
  return ["cancelado", "cancelada", "canceled", "cancelled", "estornado", "estornada", "refunded"].includes(st);
}

function financeiroErroDuplicado(boleto) {
  const erro = new Error(
    `Já existe uma cobrança para este ponto${boleto?.vencimento ? ` com vencimento em ${String(boleto.vencimento).slice(0,10)}` : ""}. ` +
    `Boleto: ${boleto?.numero || boleto?.efi_charge_id || "identificado no Supabase"}.`
  );
  erro.codigo = "BOLETO_DUPLICADO";
  erro.boleto = boleto || null;
  return erro;
}

async function financeiroValidarPonto(body) {
  const clienteId = String(body.clienteId || body.cliente_id || body.idCliente || "").trim();
  if (!clienteId) throw new Error("Não foi possível identificar o ponto do cliente. Abra o cadastro correto antes de gerar o boleto.");

  const r = await pool.query(`
    SELECT id, login_pppoe, nome, cpf_cnpj, dados
    FROM clientes
    WHERE id::text=$1
    LIMIT 1
  `, [clienteId]);
  const cliente = r.rows[0];
  if (!cliente) throw new Error("O ponto selecionado não existe mais no Supabase. Atualize o cadastro antes de gerar o boleto.");

  const dados = cliente.dados || {};
  const loginBanco = String(cliente.login_pppoe || dados.loginPppoe || dados.login || "").trim();
  const loginInformado = String(body.login || body.loginPppoe || body.clienteLogin || body.usuario || "").trim();
  if (loginInformado && loginBanco && loginInformado !== loginBanco) {
    throw new Error("O login PPPoE informado não pertence ao ponto selecionado. Atualize a página e tente novamente.");
  }
  return { clienteId, cliente, loginBanco };
}

async function financeiroBuscarDuplicado(body) {
  const { clienteId, loginBanco } = await financeiroValidarPonto(body);
  const vencimento = efiDateISO(body.vencimento || body.dueDate || body.due_date);
  if (!vencimento) throw new Error("Informe um vencimento válido para gerar o boleto.");

  const categoria = financeiroTextoNormalizado(body.categoria || "Mensalidade");
  const descricao = financeiroTextoNormalizado(body.descricao || "Boleto gerado pela Efí");
  const valor = Number(body.valor || body.total || 0) || 0;
  const mensalidade = categoria.includes("mensalidade") || descricao.includes("mensalidade");

  let r;
  if (mensalidade) {
    r = await pool.query(`
      SELECT *
      FROM boletos
      WHERE (cliente_id=$1 OR (cliente_id IS NULL AND $3<>'' AND cliente_login=$3))
        AND vencimento IS NOT NULL
        AND date_trunc('month', vencimento::timestamp)=date_trunc('month', $2::date::timestamp)
        AND (
          LOWER(COALESCE(categoria,'')) LIKE '%mensalidade%'
          OR LOWER(COALESCE(descricao,'')) LIKE '%mensalidade%'
          OR LOWER(COALESCE(dados->>'categoria','')) LIKE '%mensalidade%'
          OR LOWER(COALESCE(dados->>'descricao','')) LIKE '%mensalidade%'
        )
      ORDER BY id DESC
    `, [clienteId, vencimento, loginBanco]);
  } else {
    r = await pool.query(`
      SELECT *
      FROM boletos
      WHERE (cliente_id=$1 OR (cliente_id IS NULL AND $6<>'' AND cliente_login=$6))
        AND vencimento=$2::date
        AND ABS(COALESCE(NULLIF(total,0), valor, 0)-$3::numeric) < 0.005
        AND LOWER(TRIM(COALESCE(categoria,'')))=$4
        AND LOWER(TRIM(COALESCE(descricao,'')))=$5
      ORDER BY id DESC
    `, [clienteId, vencimento, valor, categoria, descricao, loginBanco]);
  }

  const duplicado = r.rows.find(row =>
    !financeiroStatusCancelado(row.status) && !financeiroStatusCancelado(row.efi_status)
  );
  return duplicado || null;
}

async function financeiroComTravaDoPonto(body, tarefa) {
  const clienteId = String(body.clienteId || body.cliente_id || body.idCliente || "").trim();
  if (!clienteId) throw new Error("Não foi possível identificar o ponto do cliente.");
  const client = await pool.connect();
  const chave = `fibrahub:boleto:${clienteId}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [chave]);
    return await tarefa();
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [chave]); } catch (_) {}
    client.release();
  }
}


/* Exige um Plano de Cobrança incluído no cliente antes de gerar qualquer
   boleto ou carnê. A descrição do plano é sempre usada nas cobranças. */
function financeiroErroPlanoObrigatorio() {
  const erro = new Error(
    "Inclua um Plano de Cobrança no cliente antes de gerar boleto ou carnê."
  );
  erro.codigo = "PLANO_COBRANCA_OBRIGATORIO";
  erro.httpStatus = 400;
  return erro;
}

async function financeiroAplicarDescricaoPlanoCliente(body) {
  body = {...(body || {})};

  const { clienteId, cliente, loginBanco } = await financeiroValidarPonto(body);
  const dados = cliente.dados && typeof cliente.dados === "object" ? cliente.dados : {};

  // Usa somente os campos próprios do Plano de Cobrança. Não considera profile
  // ou plano antigo do MikroTik como plano financeiro válido.
  const planoSalvo =
    dados.plano_cobranca ||
    dados.planoCobranca ||
    cliente.plano_cobranca ||
    cliente.planoCobranca ||
    {};

  const descricao = String(
    dados.descricaoBoleto ||
    dados.descricao_boleto ||
    dados.boletoDescricao ||
    dados.boleto_descricao ||
    (typeof planoSalvo === "object" ? (planoSalvo.descricao || planoSalvo.nome || "") : planoSalvo) ||
    ""
  ).trim();

  const valorPlano = Number(
    dados.valorMensal ??
    dados.mensalidade ??
    dados.valorPlano ??
    dados.cadValor ??
    (typeof planoSalvo === "object" ? (planoSalvo.valor ?? planoSalvo.valorMensal ?? planoSalvo.valor_unitario ?? 0) : 0)
  );

  if (!descricao || !Number.isFinite(valorPlano) || valorPlano <= 0) {
    throw financeiroErroPlanoObrigatorio();
  }

  body.clienteId = clienteId;
  body.cliente_id = clienteId;
  if (loginBanco) {
    body.login = loginBanco;
    body.loginPppoe = loginBanco;
    body.clienteLogin = loginBanco;
  }

  // A descrição do boleto e de todas as parcelas do carnê vem do plano incluído.
  body.descricao = descricao;
  body.descricaoPlanoCobranca = descricao;
  body.valorPlanoCobranca = valorPlano;
  return body;
}

app.post("/api/efi/boleto/criar", async (req, res) => {
  try {
    const body = await financeiroAplicarDescricaoPlanoCliente(req.body || {});
    const resultado = await financeiroComTravaDoPonto(body, async () => {
      const duplicado = await financeiroBuscarDuplicado(body);
      if (duplicado) throw financeiroErroDuplicado(duplicado);

      const conta = Number(body.conta || 1);
      const criado = await efiCriarBoletoOneStep(body, conta);
      const row = await salvarBoletoGeradoSupabase(body, criado.detalhes, conta, criado.cfg.NomeConta || ("Conta Efí " + conta));
      return { row, criado };
    });

    return res.json({
      ok: true,
      mensagem: "Boleto criado e registrado na Efí.",
      boleto: resultado.row,
      efi: resultado.criado.detalhes
    });
  } catch (err) {
    console.error("Erro /api/efi/boleto/criar:", err);
    const status = err.httpStatus || (err.codigo === "BOLETO_DUPLICADO" ? 409 : 500);
    return res.status(status).json({
      ok:false,
      erro:err.message,
      codigo:err.codigo || "",
      boletoExistente:err.boleto || null
    });
  }
});

app.post("/api/efi/carne/criar", async (req, res) => {
  try {
    const body = await financeiroAplicarDescricaoPlanoCliente(req.body || {});
    const parcelas = Array.isArray(body.parcelas)
      ? body.parcelas.map((parcela, index) => ({
          ...parcela,
          // Garante que a primeira parcela do carnê use o valor proporcional
          // quando a Data de Início da Cobrança estiver informada.
          valor: index === 0 && body.valorProporcionalPrimeira
            ? Number(body.valorProporcionalPrimeira)
            : Number(parcela.valor || body.valor || body.total || 0),
          total: index === 0 && body.valorProporcionalPrimeira
            ? Number(body.valorProporcionalPrimeira)
            : Number(parcela.total || parcela.valor || body.valor || body.total || 0),
          // A descrição de cada parcela do carnê é sempre única para a Efí.
          descricao: `${String(body.descricao || "Mensalidade").trim()} - Parcela ${index + 1}`.trim()
        }))
      : [];
    if (!parcelas.length) return res.status(400).json({ ok:false, erro:"Nenhuma parcela informada." });

    const criados = await financeiroComTravaDoPonto(body, async () => {
      const conta = Number(body.conta || 1);

      // Valida todas as parcelas antes de criar a primeira cobrança na Efí.
      for (const parcela of parcelas) {
        const payload = { ...body, ...parcela, conta };
        const duplicado = await financeiroBuscarDuplicado(payload);
        if (duplicado) throw financeiroErroDuplicado(duplicado);
      }

      const resultados = [];
      for (const parcela of parcelas) {
        const payload = { ...body, ...parcela, conta };
        const criado = await efiCriarBoletoOneStep(payload, conta);
        const row = await salvarBoletoGeradoSupabase(payload, criado.detalhes, conta, criado.cfg.NomeConta || ("Conta Efí " + conta));
        resultados.push({ boleto: row, efi: criado.detalhes });
      }
      return resultados;
    });

    return res.json({
      ok: true,
      mensagem: "Carnê criado na Efí como parcelas integradas.",
      total: criados.length,
      parcelas: criados
    });
  } catch (err) {
    console.error("Erro /api/efi/carne/criar:", err);
    const status = err.httpStatus || (err.codigo === "BOLETO_DUPLICADO" ? 409 : 500);
    return res.status(status).json({
      ok:false,
      erro:err.message,
      codigo:err.codigo || "",
      boletoExistente:err.boleto || null
    });
  }
});

app.post("/api/boletos/baixa-manual", async (req, res) => {
  try {
    const body = req.body || {};
    const numero = String(body.numero || "").trim();
    if (!numero) {
      return res.status(400).json({ ok:false, erro:"Número do boleto não informado." });
    }

    const consulta = await pool.query(
      "SELECT * FROM boletos WHERE numero=$1 LIMIT 1",
      [numero]
    );

    const boleto = consulta.rows[0];
    if (!boleto) {
      return res.status(404).json({ ok:false, erro:"Boleto não encontrado." });
    }

    const chargeId = autoTexto(boleto.efi_charge_id);
    const dadosBoleto = boleto.dados && typeof boleto.dados === "object" ? boleto.dados : {};
    const conta = Number(body.conta || body.contaEfi || dadosBoleto.contaEfi || 1) || 1;
    let cancelamentoEfi = { aplicavel:false, cancelado:false };

    // Uma baixa manual representa pagamento recebido fora da Efí. Para evitar que
    // a cobrança continue aberta, cancela primeiro na Efí e só então libera o cliente.
    if (chargeId) {
      const cfg = await efiCarregarConfig(conta);
      if (!cfg || !cfg.ClientId || !cfg.ClientSecret) {
        return res.status(400).json({
          ok:false,
          erro:"Conta Efí não configurada. A baixa manual não foi realizada e o cliente permaneceu bloqueado.",
          conta
        });
      }

      const cancelamento = await efiRequest(
        "/v1/charge/" + encodeURIComponent(chargeId) + "/cancel",
        cfg,
        { method:"PUT", body:{} }
      );

      const respostaEfi = cancelamento.json || cancelamento.raw;
      const statusAtual = String(
        efiGet(cancelamento.json, ["data.status", "status", "error_description", "message"]) || ""
      ).toLowerCase();
      const jaCancelado = statusAtual.includes("cancel") || statusAtual.includes("canceled");

      if (!cancelamento.ok && !jaCancelado) {
        return res.status(409).json({
          ok:false,
          erro:"A Efí não permitiu cancelar a cobrança. A baixa manual não foi realizada e o cliente permaneceu bloqueado.",
          efi_status:cancelamento.status,
          efi_resposta:respostaEfi
        });
      }

      cancelamentoEfi = {
        aplicavel:true,
        cancelado:true,
        jaCancelado:!cancelamento.ok && jaCancelado,
        chargeId,
        conta,
        resposta:respostaEfi
      };
    }

    const resultado = await autoProcessarPagamento({
      chargeId,
      numero,
      valorPago:body.valorPago || body.valor_pago || body.valor || boleto.total || boleto.valor,
      dataPagamento:body.dataPagamento || new Date().toISOString().slice(0,10),
      origem:"baixa_manual",
      eventoChave:"baixa-manual:" + numero + ":" + Date.now()
    });

    if (cancelamentoEfi.cancelado) {
      await pool.query(`
        UPDATE boletos SET
          efi_status='Cancelado na Efí por baixa manual',
          dados=COALESCE(dados,'{}'::jsonb) || $1::jsonb,
          atualizado_em=NOW()
        WHERE id=$2
      `, [
        JSON.stringify({
          efiStatus:"Cancelado na Efí por baixa manual",
          efiCancelado:true,
          efiCanceladoEm:new Date().toISOString(),
          efiChargeId:chargeId
        }),
        boleto.id
      ]);
    }

    return res.json({
      ok:true,
      mensagem:cancelamentoEfi.cancelado
        ? "Cobrança cancelada na Efí, baixa manual registrada e cliente liberado no MikroTik."
        : "Baixa manual registrada e cliente processado no MikroTik.",
      cancelamentoEfi,
      automacao:resultado
    });
  } catch (err) {
    console.error("Erro /api/boletos/baixa-manual:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});



app.get("/api/efi/debug-criar-boleto", async (req, res) => {
  const safe = (v) => {
    const s = String(v || "");
    if (!s) return "";
    if (s.length <= 8) return "***";
    return s.slice(0, 5) + "***" + s.slice(-4);
  };

  try {
    const conta = Number(req.query.conta || 1);
    const cfg = await efiCarregarConfig(conta);

    if (!cfg) {
      return res.status(400).json({ ok:false, erro:"Conta Efí não encontrada no Supabase." });
    }

    const info = {
      conta,
      ambiente: cfg.Ambiente || "producao",
      baseUrl: efiBaseUrl(cfg.Ambiente || "producao"),
      clientIdPreview: safe(cfg.ClientId),
      clientSecretConfigurado: Boolean(cfg.ClientSecret),
      documentoConta: safe(cfg.Documento),
      nomeConta: cfg.NomeConta || ""
    };

    let token = null;
    try {
      token = await efiGerarToken(cfg);
    } catch (e) {
      return res.status(500).json({
        ok:false,
        etapa:"oauth",
        info,
        erro:e.message
      });
    }

    const tokenInfo = {
      tokenGerado: Boolean(token && token.access_token),
      tokenType: token.token_type || "",
      expiresIn: token.expires_in || null,
      scope: token.scope || token.scopes || ""
    };

    const payload = {
      items: [{
        name: "Teste Fibra Hub",
        value: 500,
        amount: 1
      }],
      metadata: {
        custom_id: "debug-" + Date.now()
      }
    };

    const criar = await efiRequest("/v1/charge", cfg, {
      method: "POST",
      body: payload
    });

    return res.json({
      ok: true,
      etapa: "charge",
      info,
      token: tokenInfo,
      endpointTestado: "/v1/charge",
      payloadEnviado: payload,
      resposta: {
        ok: criar.ok,
        status: criar.status,
        json: criar.json,
        raw: criar.raw
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok:false,
      etapa:"erro_geral",
      erro:err.message,
      stack:String(err.stack || "").split("\n").slice(0, 5)
    });
  }
});







/* SUPABASE CLIENTES E BOLETOS LIMPO */
function fbOnlyDigits(v){ return String(v || "").replace(/\D/g, ""); }
function fbPickAny(body, keys){
  for(const k of keys){
    if(body && body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== "") return String(body[k]).trim();
  }
  return "";
}


function fbClienteFromAny(body){
  body = body || {};
  const get = (...keys) => {
    for(const k of keys){
      const v = body[k];
      if(v !== undefined && v !== null && String(v).trim() !== ""){
        return String(v).trim();
      }
    }
    return "";
  };
  return {
    login_pppoe: get("cadLogin","loginPppoe","login_pppoe","login","usuario","pppoe","clienteLogin"),
    nome: get("cadNome","nome","cliente","nomeCliente","razaoSocial","razao_social"),
    cpf_cnpj: fbOnlyDigits(get("cadCpf","cpfCnpj","cpf_cnpj","cpf","cnpj","documento")),
    telefone: get("cadTelefone1","cadTelefone2","cadTelefone3","telefone1","telefone2","telefone","celular","whatsapp"),
    plano: get("cadPlano","cadProfile","plano","planoNome","valorPlano"),
    servidor: get("cadPop","servidor","popServidor","pop","servidorPppoe"),
    profile: get("cadProfile","profile","perfil","planoVelocidade","velocidade","plano")
  };
}


async function fbEnsurePlanosCobranca(){
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS planos_cobranca (
      id SERIAL PRIMARY KEY,
      descricao TEXT NOT NULL,
      valor NUMERIC(12,2) NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_planos_cobranca_descricao_lower ON planos_cobranca (LOWER(descricao));");
}

function fbPlanoCobrancaRow(row){
  return {
    id: row.id,
    descricao: String(row.descricao || ""),
    valor: Number(row.valor || 0),
    ativo: row.ativo !== false
  };
}

app.get("/api/planos-cobranca", async (req, res) => {
  try{
    await fbEnsurePlanosCobranca();
    const r = await pool.query(`
      SELECT id, descricao, valor, ativo
      FROM planos_cobranca
      WHERE ativo=TRUE
      ORDER BY descricao ASC
    `);
    return res.json({ok:true, planos:r.rows.map(fbPlanoCobrancaRow)});
  }catch(err){
    return res.status(500).json({ok:false, erro:err.message});
  }
});

app.post("/api/planos-cobranca", async (req, res) => {
  try{
    await fbEnsurePlanosCobranca();
    console.log("[PLANOS COBRANCA] BODY RECEBIDO:", req.body);
    const descricao = String(req.body?.descricao || "").trim();
    const valor = Number(req.body?.valor);
    console.log("[PLANOS COBRANCA] PARAMETROS:", { descricao, valor, quantidade: 2 });
    if(!descricao) return res.status(400).json({ok:false, erro:"Informe a descrição do plano."});
    if(!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ok:false, erro:"Informe um valor válido para o plano."});

    const existente = await pool.query(
      "SELECT id FROM planos_cobranca WHERE LOWER(descricao)=LOWER($1) LIMIT 1",
      [descricao]
    );

    let r;
    if(existente.rows[0]){
      r = await pool.query(`
        UPDATE planos_cobranca
        SET descricao=$1, valor=$2, ativo=TRUE, atualizado_em=NOW()
        WHERE id=$3
        RETURNING id, descricao, valor, ativo
      `, [descricao, valor, existente.rows[0].id]);
    }else{
      r = await pool.query(`
        INSERT INTO planos_cobranca (descricao, valor, ativo)
        VALUES ($1,$2,$3)
        RETURNING id, descricao, valor, ativo
      `, [descricao, valor, true]);
    }

    return res.json({ok:true, plano:fbPlanoCobrancaRow(r.rows[0])});
  }catch(err){
    return res.status(500).json({ok:false, erro:err.message});
  }
});

app.delete("/api/planos-cobranca/:id", async (req, res) => {
  try{
    await fbEnsurePlanosCobranca();
    const id = Number(req.params.id);
    if(!Number.isInteger(id) || id <= 0) return res.status(400).json({ok:false, erro:"Plano inválido."});
    const r = await pool.query(`
      UPDATE planos_cobranca
      SET ativo=FALSE, atualizado_em=NOW()
      WHERE id=$1
      RETURNING id
    `, [id]);
    if(!r.rows[0]) return res.status(404).json({ok:false, erro:"Plano não encontrado."});
    return res.json({ok:true});
  }catch(err){
    return res.status(500).json({ok:false, erro:err.message});
  }
});


/* Salva somente o Plano de Cobrança do cliente.
   Não altera dados pessoais, servidor, profile ou cadastro no MikroTik. */
app.patch("/api/clientes/plano-cobranca", async (req, res) => {
  try{
    await fbEnsureTables();

    const clienteId = String(req.body?.clienteId || req.body?.cliente_id || req.body?.id || "").trim();
    const login = String(req.body?.login || req.body?.loginPppoe || req.body?.login_pppoe || "").trim();
    const remover = req.body?.remover === true;
    const descricao = remover ? "" : String(req.body?.descricao || "").trim();
    const planoId = remover ? null : (Number(req.body?.planoId || req.body?.plano_id) || null);
    const quantidade = remover ? 1 : Math.max(1, parseInt(req.body?.quantidade, 10) || 1);
    let valorUnitario = remover ? 0 : Number(req.body?.valorUnitario ?? req.body?.valor_unitario ?? req.body?.valor ?? 0);

    // Quando o plano vem selecionado pelo cadastro de planos, busca o valor oficial
    // para não salvar o vínculo com valor zerado.
    if(!remover && planoId && (!Number.isFinite(valorUnitario) || valorUnitario <= 0)){
      const planoDb = await pool.query(
        "SELECT valor FROM planos_cobranca WHERE id=$1 LIMIT 1",
        [planoId]
      );
      if(planoDb.rows[0]){
        valorUnitario = Number(planoDb.rows[0].valor || 0);
      }
    }

    const valorTotalRecebido = remover ? 0 : Number(req.body?.valorTotal ?? req.body?.valor_total);
    const valorTotal = remover
      ? 0
      : (Number.isFinite(valorTotalRecebido) && valorTotalRecebido >= 0
          ? valorTotalRecebido
          : valorUnitario * quantidade);

    if(!remover && !descricao){
      return res.status(400).json({ok:false, erro:"Informe a descrição do plano de cobrança."});
    }
    if(!remover && (!Number.isFinite(valorUnitario) || valorUnitario <= 0)){
      return res.status(400).json({ok:false, erro:"Informe um valor válido para o plano de cobrança."});
    }

    let alvo = {rows:[]};
    if(/^\d+$/.test(clienteId)){
      alvo = await pool.query("SELECT id FROM clientes WHERE id=$1 LIMIT 1", [Number(clienteId)]);
    }
    if(!alvo.rows[0] && login){
      alvo = await pool.query(`
        SELECT id FROM clientes
        WHERE login_pppoe=$1
           OR dados->>'loginPppoe'=$1
           OR dados->>'login'=$1
           OR dados->>'cadLogin'=$1
        ORDER BY atualizado_em DESC NULLS LAST, id DESC
        LIMIT 1
      `, [login]);
    }
    if(!alvo.rows[0]){
      return res.status(404).json({
        ok:false,
        erro:"Cliente ainda não está salvo no Fibra+ Hub. Salve o cadastro uma vez antes de incluir o plano de cobrança."
      });
    }

    const dadosPlano = {
      plano: descricao,
      cadPlano: descricao,
      planoCobranca: descricao,
      plano_cobranca: descricao,
      planoCobrancaId: planoId,
      plano_cobranca_id: planoId,
      valorMensal: valorTotal,
      valorUnitario: valorUnitario,
      valor_unitario: valorUnitario,
      valorPlanoUnitario: valorUnitario,
      valor_plano_unitario: valorUnitario,
      valor: valorTotal,
      mensalidade: valorTotal,
      valorPlano: valorTotal,
      cadValor: valorTotal,
      planoQuantidade: quantidade,
      quantidadePlano: quantidade,
      cadPlanoQuantidade: quantidade,
      descricaoBoleto: descricao,
      descricao_boleto: descricao,
      boletoDescricao: descricao,
      boleto_descricao: descricao
    };

    const atualizado = await pool.query(`
      UPDATE clientes
      SET plano=$1,
          dados=COALESCE(dados,'{}'::jsonb) || $2::jsonb,
          atualizado_em=NOW()
      WHERE id=$3
      RETURNING *
    `, [descricao, JSON.stringify(dadosPlano), alvo.rows[0].id]);

    return res.json({
      ok:true,
      mensagem: remover
        ? "Plano de cobrança removido do cliente."
        : "Plano de cobrança salvo no cliente.",
      cliente: fbClienteRow(atualizado.rows[0]),
      planoCobranca: dadosPlano
    });
  }catch(err){
    console.error("Erro /api/clientes/plano-cobranca:", err);
    return res.status(500).json({ok:false, erro:err.message});
  }
});

async function fbEnsureTables(){
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      login_pppoe TEXT,
      nome TEXT,
      cpf_cnpj TEXT,
      telefone TEXT,
      plano TEXT,
      servidor TEXT,
      profile TEXT,
      dados JSONB,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS boletos (
      id SERIAL PRIMARY KEY,
      numero TEXT UNIQUE,
      cliente_login TEXT,
      cliente_nome TEXT,
      cpf_cnpj TEXT,
      categoria TEXT,
      descricao TEXT,
      emissao DATE,
      vencimento DATE,
      pagamento DATE,
      desconto NUMERIC DEFAULT 0,
      valor NUMERIC DEFAULT 0,
      total NUMERIC DEFAULT 0,
      valor_pago NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'pendente',
      banco TEXT,
      agencia_conta TEXT,
      identificacao_carne TEXT,
      linha_digitavel TEXT,
      codigo_barras TEXT,
      pix TEXT,
      link_pdf TEXT,
      efi_charge_id TEXT,
      efi_status TEXT,
      efi_conta_nome TEXT,
      observacao TEXT,
      dados JSONB,
      origem TEXT,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  const alters = [
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS login_pppoe TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS nome TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefone TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS plano TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS servidor TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS profile TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS plano_cobranca_id INTEGER;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dados JSONB;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS cliente_id TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS cliente_login TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS cliente_nome TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS linha_digitavel TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS pix TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS link_pdf TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_charge_id TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_status TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_conta_nome TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS dados JSONB;"
  ];
  for(const sql of alters) await pool.query(sql);
  await pool.query("ALTER TABLE boletos ALTER COLUMN cliente_id TYPE TEXT USING cliente_id::text;");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_boletos_cliente_id ON boletos(cliente_id);");
  await pool.query(`
    UPDATE boletos b
    SET cliente_id=c.id::text
    FROM clientes c
    WHERE b.cliente_id IS NULL
      AND COALESCE(b.cliente_login,b.dados->>'loginPppoe',b.dados->>'login','') <> ''
      AND COALESCE(b.cliente_login,b.dados->>'loginPppoe',b.dados->>'login','')
        = COALESCE(c.login_pppoe,c.dados->>'loginPppoe',c.dados->>'login','')
  `);
}
function fbClienteRow(r){
  const bruto = r.dados && typeof r.dados === "object" ? r.dados : {};
  const interno = bruto.dados && typeof bruto.dados === "object" ? bruto.dados : {};
  const d = {...interno, ...bruto};
  delete d.dados;
  return {
    ...d,
    id: r.id,
    loginPppoe: r.login_pppoe || d.loginPppoe || d.login || "",
    login: r.login_pppoe || d.login || d.loginPppoe || "",
    nome: r.nome || d.nome || d.cliente || "",
    cpfCnpj: r.cpf_cnpj || d.cpfCnpj || d.cpf || "",
    cpf: r.cpf_cnpj || d.cpf || d.cpfCnpj || "",
    telefone1: r.telefone || d.telefone1 || d.telefone || "",
    plano: r.plano || d.plano || "",
    servidor: r.servidor || d.servidor || d.popServidor || "",
    popServidor: r.servidor || d.popServidor || d.servidor || "",
    profile: r.profile || d.profile || d.perfil || d.plano || "",
    statusCobranca: d.statusCobranca || d.status_cobranca || d.cadStatusCobranca || d.cli_boleto || d.boleto || d.tipoCobranca || "",
    status_cobranca: d.status_cobranca || d.statusCobranca || d.cadStatusCobranca || d.cli_boleto || d.boleto || d.tipoCobranca || "",
    data_inicio_cobranca: d.data_inicio_cobranca || d.cadInicioCobranca || d.dataInicioCobranca || d.inicioCobranca || "",
    cadInicioCobranca: d.cadInicioCobranca || d.data_inicio_cobranca || d.dataInicioCobranca || d.inicioCobranca || ""
  };
}
function fbBoletoRow(row){
  const d = row.dados || {};
  return {
    ...d,
    id: row.id,
    clienteId: String(row.cliente_id || d.clienteId || d.cliente_id || "").trim() || null,
    cliente_id: String(row.cliente_id || d.cliente_id || d.clienteId || "").trim() || null,
    numero: row.numero,
    login: row.cliente_login || d.login || d.loginPppoe || d.clienteLogin || "",
    loginPppoe: row.cliente_login || d.loginPppoe || d.login || "",
    clienteLogin: row.cliente_login || d.clienteLogin || d.login || "",
    nome: row.cliente_nome || d.nome || d.cliente || "",
    cliente: row.cliente_nome || d.cliente || d.nome || "",
    cpfCnpj: row.cpf_cnpj || d.cpfCnpj || d.cpf || "",
    cpf: row.cpf_cnpj || d.cpf || d.cpfCnpj || "",
    categoria: row.categoria || d.categoria || "",
    descricao: row.descricao || d.descricao || "",
    emissao: row.emissao || d.emissao || "",
    vencimento:
          row.vencimento ||
          d.vencimento ||
          d.dataVencimento ||
          d.expire_at ||
          d.expireAt ||
          d.due_date ||
          d.dueDate ||
          "",
    pagamento: row.pagamento || d.pagamento || d.dataPagamento || "",
    valor: Number(row.valor || d.valor || 0),
    total: Number(row.total || d.total || row.valor || 0),
    valorPago: Number(row.valor_pago || d.valorPago || 0),
    status: row.status || d.status || "pendente",
    linhaDigitavel: row.linha_digitavel || d.linhaDigitavel || "",
    pix: row.pix || d.pix || d.codigoPix || "",
    codigoPix: row.pix || d.codigoPix || d.pix || "",
    linkPdf: row.link_pdf || d.linkPdf || d.pdf || "",
    pdf: row.link_pdf || d.pdf || d.linkPdf || "",
    segundaVia: row.link_pdf || d.segundaVia || d.linkPdf || "",
    efiChargeId: row.efi_charge_id || d.efiChargeId || "",
    efiStatus: row.efi_status || d.efiStatus || "",
    efiContaNome: row.efi_conta_nome || d.efiContaNome || "",
    observacao: row.observacao || d.observacao || "",
    origem: row.origem || d.origem || ""
  };
}


function fbSomenteNumeros(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function fbFormatarCpf(valor) {
  const cpf = fbSomenteNumeros(valor).slice(0, 11);
  if (cpf.length !== 11) return String(valor || "").trim();
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function fbCpfValido(valor) {
  const cpf = fbSomenteNumeros(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(cpf[i]) * (10 - i);
  let digito = 11 - (soma % 11);
  if (digito >= 10) digito = 0;
  if (digito !== Number(cpf[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(cpf[i]) * (11 - i);
  digito = 11 - (soma % 11);
  if (digito >= 10) digito = 0;
  return digito === Number(cpf[10]);
}

function fbValidarCpfCadastro(body) {
  const origem = String((body && body.origem) || "").toLowerCase();
  const cadastroPainel = origem.includes("painel fibra+ hub") || origem.includes("painel fibra hub");
  if (!cadastroPainel) return body;
  const informado = body.cpfCnpj || body.cpf_cnpj || body.cpf || body.cadCpf || "";
  if (!fbSomenteNumeros(informado)) throw new Error("Informe o CPF do cliente.");
  if (!fbCpfValido(informado)) throw new Error("CPF inválido. Verifique os números informados.");
  const formatado = fbFormatarCpf(informado);
  body.cpfCnpj = formatado;
  body.cpf_cnpj = formatado;
  body.cpf = formatado;
  body.cadCpf = formatado;
  return body;
}

async function fbSalvarClienteSupabaseUnico(body) {
  await fbEnsureTables();
  body = fbValidarCpfCadastro(body || {});
  const c = fbClienteFromAny(body);
  if (!c.login_pppoe && !c.nome) throw new Error("Cliente sem login PPPoE ou nome.");
  const idInformado = String(body.id || body.clienteId || body.cliente_id || "").trim();
  let existente = { rows: [] };
  if (idInformado) existente = await pool.query("SELECT id FROM clientes WHERE id=$1 LIMIT 1", [idInformado]);
  else if (c.login_pppoe) existente = await pool.query(`SELECT id FROM clientes WHERE login_pppoe=$1 OR dados->>'loginPppoe'=$1 OR dados->>'login'=$1 ORDER BY atualizado_em DESC NULLS LAST, criado_em DESC NULLS LAST LIMIT 1`, [c.login_pppoe]);
  let r;
  if (existente.rows[0]) {
    r = await pool.query(`UPDATE clientes SET login_pppoe=$1,nome=$2,cpf_cnpj=$3,telefone=$4,telefone1=$5,telefone2=$6,email=$7,endereco=$8,bairro=$9,cidade=$10,uf=$11,cep=$12,referencia=$13,plano=$14,plano_cobranca_id=$15,valor_mensal=$16,dia_vencimento=$17,servidor=$18,profile=$19,data_inicio_cobranca=$20,dados=COALESCE(dados,'{}'::jsonb) || $21::jsonb,atualizado_em=NOW() WHERE id=$22 RETURNING *`, [c.login_pppoe,c.nome,c.cpf_cnpj,c.telefone,body.telefone1 || body.cadTelefone1 || null,body.telefone2 || body.cadTelefone2 || null,body.email || body.cadEmail || null,body.endereco || body.cadEndereco || null,body.bairro || body.cadBairro || null,body.cidade || body.cadCidade || null,body.uf || body.cadUf || null,body.cep || body.cadCep || null,body.referencia || body.cadReferencia || null,c.plano,body.plano_cobranca_id || body.planoCobrancaId || body.dados?.plano_cobranca_id || body.dados?.planoCobrancaId || null,body.valor_mensal || body.valorUnitario || body.valorPlanoUnitario || body.valor_plano_unitario || null,body.dia_vencimento || body.diaVencimento || body.vencimento || null,c.servidor,c.profile,body.data_inicio_cobranca || body.cadInicioCobranca || body.dataInicioCobranca || body.inicioCobranca || null,JSON.stringify({...body,origem:body.origem || "Painel Fibra+ Hub"}),existente.rows[0].id]);
  } else {
    r = await pool.query(`INSERT INTO clientes (login_pppoe,nome,cpf_cnpj,telefone,telefone1,telefone2,email,endereco,bairro,cidade,uf,cep,referencia,plano,plano_cobranca_id,valor_mensal,dia_vencimento,servidor,profile,data_inicio_cobranca,dados,atualizado_em,criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW()) RETURNING *`, [c.login_pppoe,c.nome,c.cpf_cnpj,c.telefone,body.telefone1 || body.cadTelefone1 || null,body.telefone2 || body.cadTelefone2 || null,body.email || body.cadEmail || null,body.endereco || body.cadEndereco || null,body.bairro || body.cadBairro || null,body.cidade || body.cadCidade || null,body.uf || body.cadUf || null,body.cep || body.cadCep || null,body.referencia || body.cadReferencia || null,c.plano,body.plano_cobranca_id || body.planoCobrancaId || body.dados?.plano_cobranca_id || body.dados?.planoCobrancaId || null,body.valor_mensal || body.valorUnitario || body.valorPlanoUnitario || body.valor_plano_unitario || null,body.dia_vencimento || body.diaVencimento || body.vencimento || null,c.servidor,c.profile,body.data_inicio_cobranca || body.cadInicioCobranca || body.dataInicioCobranca || body.inicioCobranca || null,JSON.stringify({...body,origem:body.origem || "Painel Fibra+ Hub"})]);
  }
  return fbClienteRow(r.rows[0]);
}

app.post("/api/clientes/salvar", async (req, res) => {
  try {
    const cliente = await fbSalvarClienteSupabaseUnico(req.body || {});
    console.log("Cliente salvo no Supabase:", cliente.loginPppoe || cliente.login, cliente.id);
    return res.json({
      ok:true,
      mensagem:"Cliente salvo no Supabase.",
      cliente
    });
  } catch (err) {
    console.error("Erro /api/clientes/salvar:", err);
    return res.status(500).json({ok:false, erro:err.message});
  }
});

app.get("/api/clientes", async (req,res)=>{
  try{
    await fbEnsureTables();
    const r = await pool.query("SELECT * FROM clientes ORDER BY atualizado_em DESC NULLS LAST, criado_em DESC NULLS LAST LIMIT 5000");
    res.json({ok:true,total:r.rows.length,clientes:r.rows.map(fbClienteRow)});
  }catch(err){
    console.error("Erro /api/clientes:", err);
    res.status(500).json({ok:false, erro:err.message});
  }
});

app.get("/api/boletos/cliente", async (req,res)=>{
  try{
    await fbEnsureTables();
    const clienteId=String(req.query.cliente_id || req.query.clienteId || req.query.id || "").trim();
    const login=String(req.query.login || req.query.loginPppoe || "").trim();
    let r;
    if(clienteId) r=await pool.query(`SELECT * FROM boletos WHERE cliente_id=$1 OR (cliente_id IS NULL AND $2<>'' AND cliente_login=$2) ORDER BY vencimento ASC NULLS LAST,id DESC`,[clienteId,login]);
    else if(login) r=await pool.query(`SELECT * FROM boletos WHERE cliente_login=$1 OR (dados IS NOT NULL AND (dados->>'login'=$1 OR dados->>'loginPppoe'=$1 OR dados->>'clienteLogin'=$1)) ORDER BY vencimento ASC NULLS LAST,id DESC`,[login]);
    else return res.status(400).json({ok:false,erro:"Informe o ID do cadastro ou o login PPPoE do ponto."});
    res.json({ok:true,total:r.rows.length,boletos:r.rows.map(fbBoletoRow)});
  }catch(err){console.error("Erro /api/boletos/cliente:",err);res.status(500).json({ok:false,erro:err.message});}
});

app.get("/api/boletos", async (req,res)=>{
  try{
    await fbEnsureTables();
    const r = await pool.query("SELECT * FROM boletos ORDER BY id DESC LIMIT 5000");
    res.json({ok:true,total:r.rows.length,boletos:r.rows.map(fbBoletoRow)});
  }catch(err){
    console.error("Erro /api/boletos:", err);
    res.status(500).json({ok:false, erro:err.message});
  }
});


/* DASHBOARD FINANCEIRO — totais reais do Supabase/PostgreSQL */
function dashboardTexto(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function dashboardNumero(valor) {
  if (valor === undefined || valor === null || valor === "") return 0;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  let texto = String(valor).trim().replace(/[R$\s]/g, "");
  if (texto.includes(",") && texto.includes(".")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
}

function dashboardDados(row) {
  const bruto = row && row.dados && typeof row.dados === "object" ? row.dados : {};
  const interno = bruto.dados && typeof bruto.dados === "object" ? bruto.dados : {};
  return { ...interno, ...bruto };
}

function dashboardPrimeiro(objetos, campos) {
  for (const obj of objetos) {
    if (!obj) continue;
    for (const campo of campos) {
      const valor = obj[campo];
      if (valor !== undefined && valor !== null && String(valor).trim() !== "") return valor;
    }
  }
  return "";
}

function dashboardClienteCobrado(row) {
  const dados = dashboardDados(row);
  const status = dashboardTexto(dashboardPrimeiro([row, dados], [
    "status", "situacao", "statusCobranca", "status_cliente", "estadoCliente", "cobranca"
  ]));
  const cancelamento = dashboardPrimeiro([row, dados], [
    "cancelamento", "dataCancelamento", "dtCancelamento", "cli_dtcancelamento"
  ]);
  const naoCobrar = [
    "cancel", "encerrado", "inativo", "excluido", "isento", "cortesia", "nao cobrar"
  ].some(palavra => status.includes(palavra));
  return !naoCobrar && !String(cancelamento || "").trim();
}

function dashboardValorCliente(row) {
  const dados = dashboardDados(row);
  return dashboardNumero(dashboardPrimeiro([row, dados], [
    "valor_mensal", "valorMensal", "mensalidade", "valorPlano", "planoValor",
    "valor_plano", "cli_valor", "preco", "price", "valor"
  ]));
}

function dashboardStatusBoleto(row) {
  const dados = dashboardDados(row);
  return dashboardTexto([
    dashboardPrimeiro([row, dados], ["status", "situacao", "estado"]),
    dashboardPrimeiro([row, dados], ["efi_status", "efiStatus", "statusEfi"])
  ].filter(Boolean).join(" "));
}

function dashboardBoletoCancelado(row) {
  const status = dashboardStatusBoleto(row);
  return ["cancel", "estorn", "refund", "devolv"].some(palavra => status.includes(palavra));
}

function dashboardValorTotalBoleto(row) {
  const dados = dashboardDados(row);
  return dashboardNumero(dashboardPrimeiro([row, dados], [
    "total", "valor", "valorBoleto", "valor_boleto", "amount"
  ]));
}

function dashboardValorPagoBoleto(row) {
  const dados = dashboardDados(row);
  return dashboardNumero(dashboardPrimeiro([row, dados], [
    "valor_pago", "valorPago", "pago", "recebido", "paid_value"
  ]));
}

function dashboardBoletoPago(row) {
  const dados = dashboardDados(row);
  const status = dashboardStatusBoleto(row);
  const total = dashboardValorTotalBoleto(row);
  const pago = dashboardValorPagoBoleto(row);
  const dataPagamento = dashboardPrimeiro([row, dados], [
    "pagamento", "data_pagamento", "dataPagamento", "recebidoEm", "dataRecebimento", "paid_at"
  ]);
  return Boolean(dataPagamento) ||
    ["pago", "paid", "baixado", "recebido", "liquidado", "quitado", "settled"].some(palavra => status.includes(palavra)) ||
    (total > 0 && pago >= total);
}

function dashboardDataPagamento(row) {
  const dados = dashboardDados(row);
  return dashboardPrimeiro([row, dados], [
    "pagamento", "data_pagamento", "dataPagamento", "recebidoEm", "dataRecebimento", "paid_at",
    "atualizado_em", "atualizadoEm", "updated_at"
  ]);
}

function dashboardDataNoMesAtual(valor) {
  if (!valor) return false;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return false;
  const hoje = new Date();
  return data.getFullYear() === hoje.getFullYear() && data.getMonth() === hoje.getMonth();
}

app.get("/api/dashboard/financeiro", async (req, res) => {
  try {
    await fbEnsureTables();
    const [clientesResult, boletosResult] = await Promise.all([
      pool.query("SELECT * FROM clientes ORDER BY id"),
      pool.query("SELECT * FROM boletos ORDER BY id")
    ]);

    const clientes = clientesResult.rows || [];
    const boletos = boletosResult.rows || [];

    const receita = clientes
      .filter(dashboardClienteCobrado)
      .reduce((soma, cliente) => soma + dashboardValorCliente(cliente), 0);

    let recebimentoMes = 0;
    let emAberto = 0;
    let boletosAbertos = 0;

    for (const boleto of boletos) {
      if (dashboardBoletoCancelado(boleto)) continue;

      const total = dashboardValorTotalBoleto(boleto);
      const valorPago = dashboardValorPagoBoleto(boleto);
      const pago = dashboardBoletoPago(boleto);

      if (pago) {
        if (dashboardDataNoMesAtual(dashboardDataPagamento(boleto))) {
          recebimentoMes += valorPago > 0 ? valorPago : total;
        }
        continue;
      }

      boletosAbertos += 1;
      emAberto += Math.max(total - valorPago, 0);
    }

    return res.json({
      ok: true,
      totais: {
        receita: Number(receita.toFixed(2)),
        recebimentoMes: Number(recebimentoMes.toFixed(2)),
        emAberto: Number(emAberto.toFixed(2)),
        boletosAbertos
      },
      fonte: "Supabase/PostgreSQL",
      atualizadoEm: new Date().toISOString()
    });
  } catch (err) {
    console.error("Erro /api/dashboard/financeiro:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.get("/api/debug/boletos", async (req,res)=>{
  try{
    await fbEnsureTables();
    const total = await pool.query("SELECT COUNT(*)::int AS total FROM boletos");
    const ultimos = await pool.query(`
      SELECT id, numero, cliente_login, cliente_nome, cpf_cnpj, valor, total, status,
             efi_charge_id, efi_status, linha_digitavel, pix, link_pdf, origem, atualizado_em, criado_em
      FROM boletos
      ORDER BY COALESCE(atualizado_em, criado_em) DESC NULLS LAST, id DESC
      LIMIT 30
    `);
    res.json({ok:true,total:total.rows[0].total,ultimos:ultimos.rows});
  }catch(err){
    res.status(500).json({ok:false,erro:err.message});
  }
});


app.post("/api/efi/boleto/pix", async (req, res) => {
  try {
    const body = req.body || {};
    const numero = String(body.numero || "").trim();
    const chargeIdBody = String(body.efi_charge_id || body.efiChargeId || "").trim();
    const conta = Number(body.conta || 1);

    let chargeId = chargeIdBody;
    if (!chargeId && numero) {
      const r = await pool.query(
        "SELECT efi_charge_id FROM boletos WHERE numero=$1 LIMIT 1",
        [numero]
      );
      chargeId = String(r.rows[0]?.efi_charge_id || "");
    }

    if (!chargeId) {
      return res.status(400).json({ ok:false, erro:"Boleto sem efi_charge_id." });
    }

    const cfg = await efiCarregarConfig(conta);
    if (!cfg || !cfg.ClientId || !cfg.ClientSecret) {
      return res.status(400).json({ ok:false, erro:"Conta Efí não configurada." });
    }

    const pixRet = await efiBuscarPixDaCobranca(cfg, chargeId);
    if (!pixRet.pix) {
      const atual = await pool.query(
        "SELECT pix, dados FROM boletos WHERE efi_charge_id=$1 OR numero=$2 LIMIT 1",
        [chargeId, numero]
      );
      const row = atual.rows[0] || {};
      const dados = row.dados || {};
      const pixSalvo = String(row.pix || dados.pix || dados.codigoPix || dados.pixCopiaCola || "").trim();

      return res.json({
        ok:true,
        encontrado:Boolean(pixSalvo),
        pix:pixSalvo,
        mensagem:pixSalvo ? "Pix preservado do Supabase." : "A Efí não retornou Pix para esta cobrança."
      });
    }

    await pool.query(`
      UPDATE boletos SET
        pix=$1,
        dados=COALESCE(dados,'{}'::jsonb) || $2::jsonb,
        atualizado_em=NOW()
      WHERE efi_charge_id=$3 OR numero=$4
    `, [
      pixRet.pix,
      JSON.stringify({
        pix: pixRet.pix,
        codigoPix: pixRet.pix,
        pixCopiaCola: pixRet.pix,
        pixAtualizadoEm: new Date().toISOString()
      }),
      chargeId,
      numero
    ]);

    return res.json({ ok:true, encontrado:true, pix:pixRet.pix });
  } catch (err) {
    console.error("Erro /api/efi/boleto/pix:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});





app.delete("/api/boletos/:numero", async (req, res) => {
  try {
    const numero = String(req.params.numero || "").trim();
    const conta = Number(req.query.conta || 1);

    if (!numero) {
      return res.status(400).json({ ok:false, erro:"Número do boleto não informado." });
    }

    const consulta = await pool.query(`
      SELECT id, numero, efi_charge_id, cliente_nome, status, origem
      FROM boletos
      WHERE numero=$1 OR efi_charge_id=$1
      LIMIT 1
    `, [numero]);

    const boleto = consulta.rows[0];

    if (!boleto) {
      return res.status(404).json({ ok:false, erro:"Boleto não encontrado no Supabase." });
    }

    const chargeId = String(boleto.efi_charge_id || "").trim();
    let canceladoEfi = false;
    let respostaEfi = null;

    if (chargeId) {
      const cfg = await efiCarregarConfig(conta);

      if (!cfg || !cfg.ClientId || !cfg.ClientSecret) {
        return res.status(400).json({
          ok:false,
          erro:"Conta Efí não configurada. O boleto não foi excluído."
        });
      }

      const cancelamento = await efiRequest(
        "/v1/charge/" + encodeURIComponent(chargeId) + "/cancel",
        cfg,
        { method:"PUT", body:{} }
      );

      respostaEfi = cancelamento.json || cancelamento.raw;

      if (!cancelamento.ok) {
        const statusAtual = String(
          efiGet(cancelamento.json, ["data.status", "status", "error_description", "message"]) || ""
        ).toLowerCase();

        const jaCancelado = statusAtual.includes("cancel") || statusAtual.includes("canceled");

        if (!jaCancelado) {
          return res.status(409).json({
            ok:false,
            erro:"A Efí não permitiu cancelar esta cobrança. O boleto foi mantido no painel.",
            efi_status: cancelamento.status,
            efi_resposta: respostaEfi
          });
        }
      }

      canceladoEfi = true;
    }

    const removido = await pool.query(`
      DELETE FROM boletos
      WHERE id=$1
      RETURNING id, numero, efi_charge_id, cliente_nome
    `, [boleto.id]);

    return res.json({
      ok:true,
      mensagem: chargeId
        ? "Boleto cancelado na Efí e excluído do painel."
        : "Boleto sem integração Efí excluído do painel.",
      canceladoEfi,
      efi_resposta: respostaEfi,
      boleto: removido.rows[0]
    });
  } catch (err) {
    console.error("Erro DELETE /api/boletos/:numero:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});



/* AUTOMAÇÃO EFI MIKROTIK - INÍCIO */

function autoTexto(v) {
  return String(v === undefined || v === null ? "" : v).trim();
}

function autoDigitos(v) {
  return autoTexto(v).replace(/\D/g, "");
}

function autoPrimeiro(obj, campos) {
  for (const campo of campos) {
    const valor = obj && obj[campo];
    if (valor !== undefined && valor !== null && autoTexto(valor) !== "") {
      return autoTexto(valor);
    }
  }
  return "";
}

function autoDados(row) {
  return row && row.dados && typeof row.dados === "object" ? row.dados : {};
}

async function autoGarantirTabelas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS automacao_eventos (
      id BIGSERIAL PRIMARY KEY,
      evento_chave TEXT UNIQUE NOT NULL,
      tipo TEXT NOT NULL,
      charge_id TEXT,
      boleto_numero TEXT,
      cliente_login TEXT,
      servidor TEXT,
      status TEXT DEFAULT 'processando',
      tentativa INTEGER DEFAULT 1,
      mensagem TEXT,
      detalhes JSONB,
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS automacao_config (
      chave TEXT PRIMARY KEY,
      valor TEXT,
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  const alters = [
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS login_pppoe TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS profile TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS plano_cobranca_id INTEGER;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS servidor TEXT;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dados JSONB;",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ativo';",
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS confianca_ate TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_charge_id TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS efi_status TEXT;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS dados JSONB;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS pagamento DATE;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS valor_pago NUMERIC DEFAULT 0;",
    "ALTER TABLE boletos ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT NOW();"
  ];

  for (const sql of alters) {
    try { await pool.query(sql); } catch (e) {}
  }
}

async function autoEventoIniciar(chave, tipo, dados = {}) {
  await autoGarantirTabelas();

  const existente = await pool.query(
    "SELECT * FROM automacao_eventos WHERE evento_chave=$1 LIMIT 1",
    [chave]
  );

  if (existente.rows[0] && existente.rows[0].status === "sucesso") {
    return { ignorar: true, evento: existente.rows[0] };
  }

  const r = await pool.query(`
    INSERT INTO automacao_eventos
      (evento_chave,tipo,charge_id,boleto_numero,cliente_login,servidor,status,tentativa,mensagem,detalhes,atualizado_em)
    VALUES
      ($1,$2,$3,$4,$5,$6,'processando',1,'Iniciando processamento',$7,NOW())
    ON CONFLICT (evento_chave) DO UPDATE SET
      status='processando',
      tentativa=automacao_eventos.tentativa+1,
      mensagem='Nova tentativa',
      detalhes=COALESCE(automacao_eventos.detalhes,'{}'::jsonb) || EXCLUDED.detalhes,
      atualizado_em=NOW()
    RETURNING *
  `, [
    chave,
    tipo,
    autoTexto(dados.charge_id),
    autoTexto(dados.boleto_numero),
    autoTexto(dados.cliente_login),
    autoTexto(dados.servidor),
    JSON.stringify(dados)
  ]);

  return { ignorar: false, evento: r.rows[0] };
}

async function autoEventoFinalizar(chave, status, mensagem, detalhes = {}) {
  try {
    await pool.query(`
      UPDATE automacao_eventos SET
        status=$1,
        mensagem=$2,
        detalhes=COALESCE(detalhes,'{}'::jsonb) || $3::jsonb,
        atualizado_em=NOW()
      WHERE evento_chave=$4
    `, [status, mensagem, JSON.stringify(detalhes), chave]);
  } catch (e) {
    console.error("Falha ao registrar automação:", e.message);
  }
}

function autoClienteCampos(cliente, boleto = {}) {
  const cd = autoDados(cliente);
  const bd = autoDados(boleto);

  const login =
    autoPrimeiro(boleto, ["cliente_login","login","login_pppoe"]) ||
    autoPrimeiro(bd, ["login","loginPppoe","clienteLogin","usuario","pppoe"]) ||
    autoPrimeiro(cliente, ["login_pppoe","pppoe","usuario","login"]) ||
    autoPrimeiro(cd, ["loginPppoe","login_pppoe","login","usuario","pppoe","clienteLogin"]);

  const servidor =
    autoPrimeiro(cliente, ["servidor"]) ||
    autoPrimeiro(cd, ["servidor","popServidor","pop","servidorPppoe"]) ||
    autoPrimeiro(bd, ["servidor","popServidor","pop"]);

  const profileAtual = autoPrimeiro(cliente, ["profile"]);
  const bloqueado = autoTexto(profileAtual).toUpperCase() === "BLOQUEADO" || autoTexto(cliente.status).toLowerCase() === "bloqueado";
  const profile =
    (bloqueado ? autoPrimeiro(cd, ["profileNormal","profile_normal","perfilNormal","perfil_normal"]) : "") ||
    profileAtual ||
    autoPrimeiro(cd, ["profile","perfil","profileServidor","planoVelocidade","velocidade"]) ||
    autoPrimeiro(cliente, ["plano"]) ||
    autoPrimeiro(cd, ["plano"]);

  return { login, servidor, profile };
}

async function autoBuscarClienteDoBoleto(boleto) {
  const bd=autoDados(boleto);
  const clienteId=String(boleto.cliente_id || bd.clienteId || bd.cliente_id || "").trim();
  if(clienteId){const r=await pool.query("SELECT * FROM clientes WHERE id=$1 LIMIT 1",[clienteId]); if(r.rows[0]) return r.rows[0];}
  const login=autoPrimeiro(boleto,["cliente_login"]) || autoPrimeiro(bd,["login","loginPppoe","clienteLogin","usuario","pppoe"]);
  if(!login) return null;
  const r=await pool.query(`SELECT * FROM clientes WHERE login_pppoe=$1 OR pppoe=$1 OR dados->>'login'=$1 OR dados->>'loginPppoe'=$1 ORDER BY id DESC LIMIT 1`,[login]);
  return r.rows[0] || null;
}

async function autoProfileExiste(cfg, profile) {
  const resposta = await routerosSend(
    cfg.host, cfg.port, cfg.user, cfg.pass,
    [["/ppp/profile/print", "?name=" + profile]],
    15000
  );
  return parseRouterosRows(resposta).some(p => autoTexto(p.name) === autoTexto(profile));
}

async function autoDerrubarSessao(cfg, login) {
  const resposta = await routerosSend(
    cfg.host, cfg.port, cfg.user, cfg.pass,
    [["/ppp/active/print", "?name=" + login]],
    15000
  );

  const ativos = parseRouterosRows(resposta);
  let removidas = 0;

  for (const ativo of ativos) {
    if (!ativo || !ativo[".id"]) continue;
    await routerosSend(
      cfg.host, cfg.port, cfg.user, cfg.pass,
      [["/ppp/active/remove", "=.id=" + ativo[".id"]]],
      15000
    );
    removidas++;
  }

  return removidas;
}

async function autoExecutarMikrotik({ servidor, login, profile, acao }) {
  if (String(process.env.AUTOMACAO_MIKROTIK_ATIVA || "true").toLowerCase() === "false") {
    return { ok:true, simulado:true, mensagem:"Automação MikroTik desativada por variável de ambiente." };
  }

  if (!servidor) throw new Error("Servidor MikroTik não definido no cadastro do cliente.");
  if (!login) throw new Error("Login PPPoE não definido no cadastro do cliente.");

  const cfg = servidorConfigClientes(servidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + (cfg.key || servidor));
  }

  const secretResp = await routerosSend(
    cfg.host, cfg.port, cfg.user, cfg.pass,
    [["/ppp/secret/print", "?name=" + login]],
    15000
  );
  const secret = parseRouterosRows(secretResp)[0];

  if (!secret || !secret[".id"]) {
    throw new Error("PPP Secret não encontrado para " + login);
  }

  const destino = acao === "bloquear"
    ? autoTexto(process.env.MIKROTIK_PROFILE_BLOQUEADO || "BLOQUEADO")
    : autoTexto(profile);

  if (!destino) {
    throw new Error("Profile normal do cliente não foi definido.");
  }

  const existe = await autoProfileExiste(cfg, destino);
  if (!existe) {
    throw new Error("Profile não existe no MikroTik " + (cfg.key || servidor) + ": " + destino);
  }

  await routerosSend(
    cfg.host, cfg.port, cfg.user, cfg.pass,
    [[
      "/ppp/secret/set",
      "=.id=" + secret[".id"],
      "=disabled=no",
      "=profile=" + destino
    ]],
    15000
  );

  const sessoesRemovidas = await autoDerrubarSessao(cfg, login);

  return {
    ok:true,
    servidor:cfg.key || servidor,
    login,
    profile:destino,
    sessoesRemovidas,
    mensagem: acao === "bloquear"
      ? "Cliente bloqueado e sessão PPP reiniciada."
      : "Cliente desbloqueado e sessão PPP reiniciada."
  };
}

async function autoProcessarPagamento({ chargeId, numero, valorPago, dataPagamento, origem, eventoChave }) {
  await autoGarantirTabelas();

  const chave = eventoChave || "pagamento:" + (chargeId || numero);
  const inicio = await autoEventoIniciar(chave, "pagamento", {
    charge_id:chargeId,
    boleto_numero:numero,
    origem
  });

  if (inicio.ignorar) {
    return { ok:true, repetido:true, mensagem:"Pagamento já processado anteriormente." };
  }

  try {
    const boletoResult = await pool.query(`
      SELECT *
      FROM boletos
      WHERE
        ($1 <> '' AND efi_charge_id=$1)
        OR ($2 <> '' AND numero=$2)
      ORDER BY atualizado_em DESC NULLS LAST
      LIMIT 1
    `, [autoTexto(chargeId), autoTexto(numero)]);

    const boleto = boletoResult.rows[0];
    if (!boleto) throw new Error("Boleto não localizado no Supabase.");

    const pagamento = dataPagamento || new Date().toISOString().slice(0,10);
    const pago = Number(valorPago || boleto.total || boleto.valor || 0) || 0;

    await pool.query(`
      UPDATE boletos SET
        status='pago',
        efi_status='Pago',
        valor_pago=CASE WHEN $1::numeric > 0 THEN $1::numeric ELSE COALESCE(total,valor,0) END,
        pagamento=$2,
        dados=COALESCE(dados,'{}'::jsonb) || $3::jsonb,
        atualizado_em=NOW()
      WHERE id=$4
    `, [
      pago,
      pagamento,
      JSON.stringify({
        status:"pago",
        efiStatus:"Pago",
        valorPago:pago,
        dataPagamento:pagamento,
        pagamentoAutomatico:true,
        origemPagamento:origem || "efi_webhook",
        processadoEm:new Date().toISOString()
      }),
      boleto.id
    ]);

    const cliente = await autoBuscarClienteDoBoleto(boleto);
    if (!cliente) throw new Error("Cliente do boleto não localizado no Supabase.");

    const campos = autoClienteCampos(cliente, boleto);
    const mikrotik = await autoExecutarMikrotik({
      servidor:campos.servidor,
      login:campos.login,
      profile:campos.profile,
      acao:"pagamento"
    });

    await pool.query(`
      UPDATE clientes SET
        status='ativo',
        profile=$1,
        confianca_ate='',
        dados=COALESCE(dados,'{}'::jsonb) || $2::jsonb,
        atualizado_em=NOW()
      WHERE id=$3
    `, [
      campos.profile,
      JSON.stringify({
        status:"ativo",
        profile:campos.profile,
        perfil:campos.profile,
        profileNormal:campos.profile,
        ultimoDesbloqueioAutomatico:new Date().toISOString(),
        ultimoPagamentoChargeId:autoTexto(chargeId)
      }),
      cliente.id
    ]);

    await autoEventoFinalizar(chave, "sucesso", "Pagamento processado e cliente desbloqueado.", {
      mikrotik,
      cliente_id:cliente.id
    });

    return {
      ok:true,
      boleto:boleto.numero,
      charge_id:boleto.efi_charge_id,
      cliente:cliente.nome,
      mikrotik
    };
  } catch (err) {
    await autoEventoFinalizar(chave, "erro", err.message, {});
    throw err;
  }
}

async function autoProcessarBloqueioCliente(cliente, boleto) {
  return autoComTravaBanco("fibra-bloqueio-cliente:" + cliente.id, async () => {
    const campos = autoClienteCampos(cliente, boleto);
    const jaBloqueado =
      autoTexto(cliente.profile).toUpperCase() === "BLOQUEADO" ||
      autoTexto(cliente.status).toLowerCase() === "bloqueado";

    if (jaBloqueado) {
      return { ok:true, repetido:true, motivo:"cliente_ja_bloqueado" };
    }

  // Cada liberação em confiança cria um novo ciclo de bloqueio. Sem esse
  // marcador, o evento do primeiro bloqueio era tratado como já concluído e
  // impedia o MikroTik de bloquear novamente após o vencimento das 24 horas.
    const cicloConfianca = autoTexto(cliente.confianca_ate);
    const chave = "bloqueio:" + cliente.id + ":" + boleto.numero +
      (cicloConfianca ? ":confianca:" + cicloConfianca : "");
    const inicio = await autoEventoIniciar(chave, "bloqueio", {
      boleto_numero:boleto.numero,
      cliente_login:campos.login,
      servidor:campos.servidor,
      confianca_ate:cicloConfianca
    });

    if (inicio.ignorar) return { ok:true, repetido:true };

    try {
      const mikrotik = await autoExecutarMikrotik({
        servidor:campos.servidor,
        login:campos.login,
        profile:campos.profile,
        acao:"bloquear"
      });

      await pool.query(`
        UPDATE clientes SET
          status='bloqueado',
          profile='BLOQUEADO',
          confianca_ate='',
          dados=COALESCE(dados,'{}'::jsonb) || $1::jsonb,
          atualizado_em=NOW()
        WHERE id=$2
      `, [
        JSON.stringify({
          status:"bloqueado",
          bloqueioAutomaticoEm:new Date().toISOString(),
          boletoVencido:boleto.numero,
          profileNormal:campos.profile
        }),
        cliente.id
      ]);

      await autoEventoFinalizar(chave, "sucesso", "Cliente bloqueado automaticamente.", { mikrotik });
      return { ok:true, cliente:cliente.nome, boleto:boleto.numero, mikrotik };
    } catch (err) {
      await autoEventoFinalizar(chave, "erro", err.message, {});
      throw err;
    }
  });
}

async function autoComTravaBanco(nome, tarefa) {
  const conexao = await pool.connect();
  let travado = false;

  try {
    const r = await conexao.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS travado",
      [nome]
    );
    travado = Boolean(r.rows[0]?.travado);

    if (!travado) {
      return {
        ok:true,
        ignorado:true,
        motivo:"rotina_ja_em_execucao"
      };
    }

    return await tarefa();
  } finally {
    if (travado) {
      try {
        await conexao.query("SELECT pg_advisory_unlock(hashtext($1))", [nome]);
      } catch (err) {
        console.error("Falha ao liberar trava da automação:", err.message);
      }
    }
    conexao.release();
  }
}

async function autoExecutarConfiancasVencidas() {
  return autoComTravaBanco("fibra-confiancas-vencidas", async () => {
    await autoGarantirTabelas();

  const dias = Math.max(0, Number(process.env.BLOQUEIO_DIAS_APOS_VENCIMENTO || 4));
  const limite = Math.max(1, Math.min(500, Number(process.env.CONFIANCA_MAX_CLIENTES_POR_EXECUCAO || 100)));

  // Esta rotina é intencionalmente curta: roda a cada minuto e trata somente
  // clientes cuja confiança de 24 horas acabou. A conciliação Efí e os demais
  // bloqueios continuam na rotina diária, evitando carga desnecessária.
  const candidatos = await pool.query(`
    SELECT DISTINCT ON (c.id)
      c.*,
      b.id AS boleto_id,
      b.cliente_id AS boleto_cliente_id,
      b.numero AS boleto_numero,
      b.cliente_login AS boleto_login,
      b.cliente_nome AS boleto_cliente_nome,
      b.cpf_cnpj AS boleto_cpf_cnpj,
      b.vencimento AS boleto_vencimento,
      b.status AS boleto_status,
      b.dados AS boleto_dados
    FROM clientes c
    JOIN boletos b ON (
      b.cliente_id=c.id::text OR (
        b.cliente_id IS NULL
        AND COALESCE(c.login_pppoe,c.dados->>'loginPppoe',c.dados->>'login','') <> ''
        AND COALESCE(c.login_pppoe,c.dados->>'loginPppoe',c.dados->>'login','')=COALESCE(b.cliente_login,b.dados->>'loginPppoe',b.dados->>'login','')
      )
    )
    WHERE
      lower(COALESCE(c.status,''))='confianca'
      AND c.confianca_ate ~ '^\\d{4}-\\d{2}-\\d{2}T'
      AND c.confianca_ate::timestamptz <= NOW()
      AND lower(COALESCE(b.status,'pendente')) NOT IN ('pago','paid','cancelado','canceled')
      AND b.vencimento IS NOT NULL
      AND b.vencimento < (CURRENT_DATE - $1::integer)
    ORDER BY c.id, b.vencimento ASC
    LIMIT $2
  `, [dias, limite]);

  const resultados = [];

  for (const row of candidatos.rows) {
    const boleto = {
      id:row.boleto_id,
      cliente_id:row.boleto_cliente_id,
      numero:row.boleto_numero,
      cliente_login:row.boleto_login,
      cliente_nome:row.boleto_cliente_nome,
      cpf_cnpj:row.boleto_cpf_cnpj,
      vencimento:row.boleto_vencimento,
      status:row.boleto_status,
      dados:row.boleto_dados || {}
    };

    try {
      resultados.push(await autoProcessarBloqueioCliente(row, boleto));
    } catch (err) {
      resultados.push({
        ok:false,
        cliente:row.nome,
        boleto:row.boleto_numero,
        erro:err.message
      });
    }
  }

    return {
      ok:true,
      executadoEm:new Date().toISOString(),
      confiancasVencidas:candidatos.rows.length,
      bloqueios:resultados
    };
  });
}

async function autoExecutarRotinaDiaria() {
  await autoGarantirTabelas();

  // Concilia cobranças Efí pendentes, inclusive as criadas antes do webhook automático.
  const pendentesEfi = await pool.query(`
    SELECT *
    FROM boletos
    WHERE efi_charge_id IS NOT NULL
      AND efi_charge_id <> ''
      AND lower(COALESCE(status,'pendente')) NOT IN ('pago','paid','cancelado','canceled')
    ORDER BY atualizado_em DESC NULLS LAST
    LIMIT 100
  `);

  const conciliacaoEfi = [];
  const cfgPadrao = await efiCarregarConfig(1);
  const webhookPublico = autoBasePublica() ? autoBasePublica() + "/api/efi/webhook" : "";

  if (cfgPadrao && cfgPadrao.ClientId && cfgPadrao.ClientSecret) {
    for (const boleto of pendentesEfi.rows) {
      try {
        const chargeId = autoTexto(boleto.efi_charge_id);

        if (webhookPublico) {
          try {
            await efiRequest(
              "/v1/charge/" + encodeURIComponent(chargeId) + "/metadata",
              cfgPadrao,
              {
                method:"PUT",
                body:{ notification_url:webhookPublico }
              }
            );
          } catch (e) {}
        }

        const detalhe = await efiDetalharPorId(cfgPadrao, chargeId);
        if (!detalhe.ok) {
          conciliacaoEfi.push({ ok:false, charge_id:chargeId, erro:"Consulta Efí falhou." });
          continue;
        }

        const statusAtual = autoTexto(
          detalhe.detalhes?.status ||
          detalhe.detalhes?.situacao_efi
        ).toLowerCase();

        await pool.query(`
          UPDATE boletos SET
            efi_status=$1,
            dados=COALESCE(dados,'{}'::jsonb) || $2::jsonb,
            atualizado_em=NOW()
          WHERE id=$3
        `, [
          statusAtual || boleto.efi_status || "",
          JSON.stringify({
            efiStatus:statusAtual || boleto.efi_status || "",
            ultimaConciliacaoEfi:new Date().toISOString()
          }),
          boleto.id
        ]);

        if (["paid","settled","pago"].includes(statusAtual)) {
          const resultado = await autoProcessarPagamento({
            chargeId,
            numero:boleto.numero,
            valorPago:boleto.total || boleto.valor,
            dataPagamento:new Date().toISOString().slice(0,10),
            origem:"conciliacao_efi_diaria",
            eventoChave:"pagamento:" + chargeId
          });
          conciliacaoEfi.push({ ok:true, charge_id:chargeId, pagamento:true, resultado });
        } else {
          conciliacaoEfi.push({ ok:true, charge_id:chargeId, status:statusAtual || "desconhecido" });
        }
      } catch (err) {
        conciliacaoEfi.push({
          ok:false,
          charge_id:autoTexto(boleto.efi_charge_id),
          erro:err.message
        });
      }
    }
  }

  const dias = Math.max(0, Number(process.env.BLOQUEIO_DIAS_APOS_VENCIMENTO || 4));
  const limite = Math.max(1, Math.min(500, Number(process.env.BLOQUEIO_MAX_CLIENTES_POR_EXECUCAO || 100)));

  const candidatos = await pool.query(`
    SELECT DISTINCT ON (c.id)
      c.*,
      b.id AS boleto_id,
      b.cliente_id AS boleto_cliente_id,
      b.numero AS boleto_numero,
      b.cliente_login AS boleto_login,
      b.cliente_nome AS boleto_cliente_nome,
      b.cpf_cnpj AS boleto_cpf_cnpj,
      b.vencimento AS boleto_vencimento,
      b.status AS boleto_status,
      b.dados AS boleto_dados
    FROM clientes c
    JOIN boletos b ON (
      b.cliente_id=c.id::text OR (
        b.cliente_id IS NULL
        AND COALESCE(c.login_pppoe,c.dados->>'loginPppoe',c.dados->>'login','') <> ''
        AND COALESCE(c.login_pppoe,c.dados->>'loginPppoe',c.dados->>'login','')=COALESCE(b.cliente_login,b.dados->>'loginPppoe',b.dados->>'login','')
      )
    )
    WHERE
      lower(COALESCE(b.status,'pendente')) NOT IN ('pago','paid','cancelado','canceled')
      AND b.vencimento IS NOT NULL
      AND b.vencimento < (CURRENT_DATE - $1::integer)
      AND CASE
        WHEN NULLIF(BTRIM(c.confianca_ate), '') IS NULL THEN TRUE
        WHEN c.confianca_ate ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN c.confianca_ate::timestamptz <= NOW()
        WHEN c.confianca_ate ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN c.confianca_ate::date < CURRENT_DATE
        ELSE TRUE
      END
    ORDER BY c.id, b.vencimento ASC
    LIMIT $2
  `, [dias, limite]);

  const resultados = [];

  for (const row of candidatos.rows) {
    const boleto = {
      id:row.boleto_id,
      cliente_id:row.boleto_cliente_id,
      numero:row.boleto_numero,
      cliente_login:row.boleto_login,
      cliente_nome:row.boleto_cliente_nome,
      cpf_cnpj:row.boleto_cpf_cnpj,
      vencimento:row.boleto_vencimento,
      status:row.boleto_status,
      dados:row.boleto_dados || {}
    };

    try {
      resultados.push(await autoProcessarBloqueioCliente(row, boleto));
    } catch (err) {
      resultados.push({
        ok:false,
        cliente:row.nome,
        boleto:row.boleto_numero,
        erro:err.message
      });
    }
  }

  // Reconcilia pagamentos que foram baixados, mas cujo desbloqueio falhou.
  const reconciliar = await pool.query(`
    SELECT b.*
    FROM boletos b
    LEFT JOIN automacao_eventos a
      ON a.charge_id=b.efi_charge_id AND a.tipo='pagamento'
    WHERE lower(COALESCE(b.status,'')) IN ('pago','paid')
      AND b.efi_charge_id IS NOT NULL
      AND b.efi_charge_id <> ''
      AND (a.id IS NULL OR a.status='erro')
    ORDER BY b.atualizado_em DESC NULLS LAST
    LIMIT 50
  `);

  const reconciliados = [];
  for (const b of reconciliar.rows) {
    try {
      reconciliados.push(await autoProcessarPagamento({
        chargeId:b.efi_charge_id,
        numero:b.numero,
        valorPago:b.valor_pago || b.total || b.valor,
        dataPagamento:b.pagamento,
        origem:"reconciliacao_diaria",
        eventoChave:"pagamento:" + b.efi_charge_id
      }));
    } catch (err) {
      reconciliados.push({ ok:false, boleto:b.numero, erro:err.message });
    }
  }

  return {
    ok:true,
    cobrancasEfiAnalisadas:pendentesEfi.rows.length,
    conciliacaoEfi,
    bloqueiosAnalisados:candidatos.rows.length,
    bloqueios:resultados,
    reconciliacoes:reconciliados
  };
}

function autoBasePublica(req) {
  const configurada = autoTexto(process.env.PUBLIC_BASE_URL || process.env.APP_URL);
  if (configurada) return configurada.replace(/\/+$/, "");

  const vercel = autoTexto(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL);
  if (vercel) return ("https://" + vercel).replace(/\/+$/, "");

  if (req) {
    const proto = autoTexto(req.headers["x-forwarded-proto"] || req.protocol || "https");
    const host = autoTexto(req.headers["x-forwarded-host"] || req.headers.host);
    if (host) return proto + "://" + host;
  }

  return "";
}

async function autoSalvarSegredoVault(nome, valor, descricao) {
  const atual = await pool.query(`
    SELECT id
    FROM vault.decrypted_secrets
    WHERE name=$1
    ORDER BY updated_at DESC
    LIMIT 1
  `, [nome]);

  if (atual.rows[0]?.id) {
    await pool.query(
      "SELECT vault.update_secret($1::uuid, $2, $3, $4)",
      [atual.rows[0].id, valor, nome, descricao]
    );
    return atual.rows[0].id;
  }

  const criado = await pool.query(
    "SELECT vault.create_secret($1, $2, $3) AS id",
    [valor, nome, descricao]
  );
  return criado.rows[0]?.id || null;
}

async function autoConfigurarCronConfiancasGratuito(req) {
  const baseUrl = autoBasePublica(req);
  const segredo = autoTexto(process.env.CRON_SECRET);

  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error("URL pública do painel não identificada. Configure PUBLIC_BASE_URL na Vercel.");
  }
  if (!segredo) {
    throw new Error("CRON_SECRET não configurado na Vercel.");
  }

  // A Vercel Hobby aceita apenas o cron diário. A checagem de confiança usa
  // pg_cron + pg_net no Supabase, mantendo a execução a cada minuto sem Pro.
  await pool.query("CREATE EXTENSION IF NOT EXISTS supabase_vault");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_cron");

  await autoSalvarSegredoVault(
    "fibra_public_base_url",
    baseUrl.replace(/\/+$/, ""),
    "URL do Fibra+ usada pelo cron gratuito das confianças"
  );
  await autoSalvarSegredoVault(
    "fibra_cron_secret",
    segredo,
    "Token do endpoint de automação do Fibra+"
  );

  const nomeJob = "fibra-confiancas-vencidas-cada-minuto";
  await pool.query(
    "SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname=$1",
    [nomeJob]
  );

  const comando = `
    SELECT net.http_get(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name='fibra_public_base_url'
        ORDER BY updated_at DESC
        LIMIT 1
      ) || '/api/cron/confiancas',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name='fibra_cron_secret'
          ORDER BY updated_at DESC
          LIMIT 1
        )
      ),
      timeout_milliseconds := 55000
    ) AS request_id;
  `;

  const agendado = await pool.query(
    "SELECT cron.schedule($1, $2, $3) AS jobid",
    [nomeJob, "* * * * *", comando]
  );

  return {
    ok:true,
    ativo:true,
    jobid:agendado.rows[0]?.jobid || null,
    agenda:"a cada minuto",
    executor:"Supabase Cron",
    baseUrl:baseUrl.replace(/\/+$/, "")
  };
}

app.post("/api/efi/webhook", async (req, res) => {
  const token = autoTexto(
    req.body?.notification ||
    req.body?.token ||
    req.query?.notification ||
    req.query?.token
  );

  if (!token) {
    return res.status(400).json({ ok:false, erro:"Token de notificação não informado." });
  }

  try {
    await autoGarantirTabelas();

    const contas = await pool.query(`
      SELECT conta
      FROM efi_configuracoes
      WHERE COALESCE(ativo,TRUE)=TRUE
      ORDER BY conta
    `);

    const ids = contas.rows.length ? contas.rows.map(r => Number(r.conta)) : [1];
    let notificacao = null;
    let contaUsada = null;
    let ultimoErro = "";

    for (const conta of ids) {
      try {
        const cfg = await efiCarregarConfig(conta);
        if (!cfg || !cfg.ClientId || !cfg.ClientSecret) continue;

        const resposta = await efiRequest(
          "/v1/notification/" + encodeURIComponent(token),
          cfg
        );

        if (resposta.ok && resposta.json) {
          notificacao = resposta.json;
          contaUsada = conta;
          break;
        }

        ultimoErro = JSON.stringify(resposta.json || resposta.raw || "");
      } catch (e) {
        ultimoErro = e.message;
      }
    }

    if (!notificacao) {
      throw new Error("Não foi possível consultar a notificação na Efí. " + ultimoErro);
    }

    const eventos = Array.isArray(notificacao.data) ? notificacao.data : [];
    const processados = [];

    for (const evento of eventos) {
      const statusAtual = autoTexto(evento?.status?.current).toLowerCase();
      const chargeId = autoTexto(evento?.identifiers?.charge_id);
      if (!chargeId) continue;

      if (["paid","settled"].includes(statusAtual)) {
        const valor = Number(evento.value || 0) / 100;
        const resultado = await autoProcessarPagamento({
          chargeId,
          numero:autoTexto(evento.custom_id),
          valorPago:valor,
          dataPagamento:autoTexto(evento.received_by_bank_at) || new Date().toISOString().slice(0,10),
          origem:"efi_webhook",
          eventoChave:"efi:" + token + ":" + evento.id + ":" + statusAtual
        });
        processados.push({ status:statusAtual, charge_id:chargeId, resultado });
      } else {
        await pool.query(`
          UPDATE boletos SET
            efi_status=$1,
            dados=COALESCE(dados,'{}'::jsonb) || $2::jsonb,
            atualizado_em=NOW()
          WHERE efi_charge_id=$3
        `, [
          statusAtual,
          JSON.stringify({
            efiStatus:statusAtual,
            ultimaNotificacaoEfi:new Date().toISOString(),
            tokenNotificacao:token
          }),
          chargeId
        ]);
        processados.push({ status:statusAtual, charge_id:chargeId, atualizado:true });
      }
    }

    return res.status(200).json({
      ok:true,
      conta:contaUsada,
      token,
      eventos:eventos.length,
      processados
    });
  } catch (err) {
    console.error("Erro /api/efi/webhook:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.get("/api/cron/bloqueios", async (req, res) => {
  const segredo = autoTexto(process.env.CRON_SECRET);
  const recebido = autoTexto(req.headers.authorization);

  if (!segredo || recebido !== "Bearer " + segredo) {
    return res.status(401).json({ ok:false, erro:"Não autorizado." });
  }

  try {
    const resultado = await autoExecutarRotinaDiaria();
    return res.json(resultado);
  } catch (err) {
    console.error("Erro /api/cron/bloqueios:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.get("/api/cron/confiancas", async (req, res) => {
  const segredo = autoTexto(process.env.CRON_SECRET);
  const recebido = autoTexto(req.headers.authorization);

  if (!segredo || recebido !== "Bearer " + segredo) {
    return res.status(401).json({ ok:false, erro:"Não autorizado." });
  }

  try {
    const resultado = await autoExecutarConfiancasVencidas();
    return res.json(resultado);
  } catch (err) {
    console.error("Erro /api/cron/confiancas:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.get("/api/automacao/cron-gratuito/status", async (req, res) => {
  try {
    const extensao = await pool.query(
      "SELECT to_regclass('cron.job') IS NOT NULL AS disponivel"
    );
    if (!extensao.rows[0]?.disponivel) {
      return res.json({ ok:true, ativo:false, motivo:"Supabase Cron ainda não ativado." });
    }

    const job = await pool.query(`
      SELECT jobid, schedule, active
      FROM cron.job
      WHERE jobname='fibra-confiancas-vencidas-cada-minuto'
      ORDER BY jobid DESC
      LIMIT 1
    `);

    return res.json({
      ok:true,
      ativo:Boolean(job.rows[0]?.active),
      jobid:job.rows[0]?.jobid || null,
      agenda:job.rows[0]?.schedule || null,
      executor:"Supabase Cron"
    });
  } catch (err) {
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.post("/api/automacao/cron-gratuito/configurar", async (req, res) => {
  if (!hasPermission(req.sessionUser, "configuracoes")) {
    return res.status(403).json({ ok:false, erro:"Usuário sem permissão de configurações." });
  }

  try {
    const resultado = await autoConfigurarCronConfiancasGratuito(req);
    const verificacao = await autoExecutarConfiancasVencidas();
    return res.json({ ...resultado, verificacao });
  } catch (err) {
    console.error("Erro ao configurar cron gratuito:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.post("/api/automacao/testar-pagamento", async (req, res) => {
  try {
    const resultado = await autoProcessarPagamento({
      chargeId:autoTexto(req.body?.chargeId || req.body?.efi_charge_id),
      numero:autoTexto(req.body?.numero),
      valorPago:req.body?.valorPago,
      dataPagamento:req.body?.dataPagamento,
      origem:"teste_manual_backend",
      eventoChave:"teste:" + Date.now()
    });
    return res.json(resultado);
  } catch (err) {
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.get("/api/automacao/status", async (req, res) => {
  try {
    await autoGarantirTabelas();
    const ultimos = await pool.query(`
      SELECT *
      FROM automacao_eventos
      ORDER BY atualizado_em DESC
      LIMIT 50
    `);

    return res.json({
      ok:true,
      webhook:autoBasePublica(req) + "/api/efi/webhook",
      cron:"/api/cron/bloqueios",
      mikrotikAtivo:String(process.env.AUTOMACAO_MIKROTIK_ATIVA || "true").toLowerCase() !== "false",
      profileBloqueado:process.env.MIKROTIK_PROFILE_BLOQUEADO || "BLOQUEADO",

      eventos:ultimos.rows
    });
  } catch (err) {
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

/* AUTOMAÇÃO EFI MIKROTIK - FIM */







app.get("/api/debug/cliente-salvo", async (req, res) => {
  try {
    await fbEnsureTables();
    const chave = String(req.query.chave || req.query.login || req.query.cpf || "").trim();
    if (!chave) {
      const r = await pool.query("SELECT * FROM clientes ORDER BY atualizado_em DESC NULLS LAST, criado_em DESC NULLS LAST LIMIT 10");
      return res.json({ok:true, clientes:r.rows.map(fbClienteRow)});
    }
    const digitos = chave.replace(/\D/g, "");
    const r = await pool.query(`
      SELECT * FROM clientes
      WHERE id::text=$1 OR login_pppoe=$1
         OR ($2<>'' AND regexp_replace(COALESCE(cpf_cnpj,''),'\D','','g')=$2)
      ORDER BY atualizado_em DESC NULLS LAST
      LIMIT 1
    `, [chave, digitos]);
    return res.json({ok:true, encontrado:Boolean(r.rows[0]), cliente:r.rows[0] ? fbClienteRow(r.rows[0]) : null});
  } catch (err) {
    return res.status(500).json({ok:false, erro:err.message});
  }
});

io.on("connection",(socket)=>{
  socket.emit("hub-update", geral());
  socket.emit("mikrotik-update", geral());
});

const PORT=process.env.PORT || 3000;

// Na Vercel, o Express precisa ser exportado como função serverless.
// Fora da Vercel, continua rodando normal com npm start.
async function iniciarBancoFibra() {
  await initDb();
  await centralEnsureTables();
}

if (process.env.VERCEL) {
  iniciarBancoFibra().catch(err => console.error("Erro ao iniciar banco:", err.message));
  module.exports = app;
} else {
  iniciarBancoFibra().finally(() => server.listen(PORT, () => console.log("Fibra+ Hub 2 Servidores rodando na porta " + PORT)));
}
