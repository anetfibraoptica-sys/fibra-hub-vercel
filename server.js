const path = require('path');
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

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


async function criarPPPoECliente(cliente) {
  const cfg = servidorConfig(cliente.servidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas no Render para " + cfg.key);
  }

  const usuario = cliente.pppoe || cliente.usuario || "";
  const senha = cliente.senha || "";
  const plano = cliente.plano || "default";

  if (!usuario || !senha) {
    throw new Error("Usuário PPPoE ou senha não informado.");
  }

  const comentario = [
    cliente.nome ? `CLIENTE: ${cliente.nome}` : "",
    cliente.telefone ? `TEL: ${cliente.telefone}` : "",
    cliente.servidor ? `SERVIDOR: ${cliente.servidor}` : "",
    cliente.valor ? `VALOR: ${cliente.valor}` : ""
  ].filter(Boolean).join(" | ");

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

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const TOKEN = process.env.PANEL_TOKEN || "fibra2026";
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
  const cfg = servidorConfig(cliente.servidor);
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
  const comentario = [
    cliente.nome ? `CLIENTE: ${cliente.nome}` : "",
    cliente.telefone ? `TEL: ${cliente.telefone}` : "",
    cliente.servidor ? `SERVIDOR: ${cliente.servidor}` : "",
    cliente.valor ? `VALOR: ${cliente.valor}` : ""
  ].filter(Boolean).join(" | ");

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
  const cfg = servidorConfig(cliente.servidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + cfg.key);
  }

  const usuario = String(cliente.pppoe || "").trim();
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
  res.json({ ok: true, login: "admin/admin ativo" });
});


app.post("/api/login", async (req, res) => {
  try {
    const body = req.body || {};
    const usuario = String(body.usuario || body.login || body.user || "").trim();
    const senha = String(body.senha || body.password || body.pass || "").trim();

    if (usuario === "admin" && senha === "admin") {
      return res.json({
        ok: true,
        token: "fibra-admin",
        usuario: { usuario: "admin", nome: "Administrador", tipo: "admin" }
      });
    }

    try {
      const r = await pool.query(
        "SELECT * FROM usuarios WHERE usuario=$1 AND senha=$2 LIMIT 1",
        [usuario, senha]
      );

      if (r.rows.length) {
        return res.json({ ok: true, token: "fibra-admin", usuario: r.rows[0] });
      }
    } catch (e) {
      console.log("Login banco ignorado:", e.message);
    }

    return res.status(401).json({ ok: false, erro: "Usuário ou senha inválidos" });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});


app.get("/api/status",(req,res)=>{
  res.json({ sistema:"Fibra+ Hub 2 Servidores", status:"online", banco:!!process.env.DATABASE_URL, versao:"10.0.0" });
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
  const cfg = servidorConfig(cliente.servidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + cfg.key);
  }

  const usuario = String(cliente.pppoe || "").trim();
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
    caller_id: active["caller-id"] || ""
  };
}

async function fetchViaMikroTik(cfg, url) {
  const resp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
    "/tool/fetch",
    `=url=${url}`,
    "=output=user",
    "=as-value="
  ]], 20000);

  const rows = parseRouterosRows(resp);
  const row = rows[0] || {};
  return row.data || row.contents || row["data"] || "";
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
  const cfg = servidorConfig(cliente.servidor);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik não configuradas para " + cfg.key);
  }

  const usuario = String(cliente.pppoe || "").trim();
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
  const clienteAntigo = { ...cliente, servidor: servidorAntigo };
  const cfg = servidorConfig(clienteAntigo.servidor);

  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("Variáveis do MikroTik antigo não configuradas para " + cfg.key);
  }

  const usuario = String(cliente.pppoe || "").trim();
  if (!usuario) throw new Error("Cliente sem usuário PPPoE para migrar.");

  // Derruba sessão ativa se existir.
  try {
    const activeResp = await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/ppp/active/print",
      `?name=${usuario}`
    ]]);

    const activeRows = typeof parseRouterosRows === "function" ? parseRouterosRows(activeResp) : [];
    const activeId = activeRows.length ? (activeRows[0][".id"] || activeRows[0]["id"]) : "";

    if (activeId) {
      await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
        "/ppp/active/remove",
        `=.id=${activeId}`
      ]]);
    }
  } catch (e) {
    console.log("Sessão ativa não encontrada ou já desconectada:", usuario);
  }

  // Remove o secret do servidor antigo.
  try {
    await routerosSend(cfg.host, cfg.port, cfg.user, cfg.pass, [[
      "/ppp/secret/remove",
      `=numbers=${usuario}`
    ]]);
  } catch (e) {
    const msg = String(e.message || "").toLowerCase();
    if (!(msg.includes("no such") || msg.includes("not found") || msg.includes("does not"))) {
      throw e;
    }
  }

  return true;
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
        vencimento=$15, valor=$16, status=$17, observacoes=$18
       WHERE id=$19 RETURNING *`,
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
    const up = await pool.query("UPDATE clientes SET status='bloqueado', confianca_ate='' WHERE id=$1 RETURNING *", [req.params.id]);

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
    await acaoPPPoECliente(cliente, "desbloquear");
    const up = await pool.query("UPDATE clientes SET status='ativo', confianca_ate='' WHERE id=$1 RETURNING *", [req.params.id]);

    res.json({ ok:true, acao:"desbloqueado", cliente:up.rows[0] });
  } catch (error) {
    res.status(500).json({ ok:false, erro:error.message });
  }
});

app.post("/api/clientes/:id/confianca", async (req, res) => {
  try {
    const dias = Number(req.body.dias || 7);
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

app.delete("/api/clientes/:id", async (req,res)=>{
  try { await pool.query("DELETE FROM clientes WHERE id=$1",[req.params.id]); res.json({ok:true}); }
  catch(e){ res.status(500).json({ok:false, erro:e.message}); }
});


app.get("/api/mikrotik/test", async (req, res) => {
  try {
    const servidor = req.query.servidor || "COLONIA ANTONIO ALEIXO";
    const cfg = servidorConfig(servidor);
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
  const cfg = servidorConfig(nomeServidor);

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
  const cfg = servidorConfig(nomeServidor);
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

    // Usa a mesma base do /api/online: servidorConfig + routerosSend + parseRouterosRows.
    const cfg = servidorConfig(servidorNome);

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
    const body = req.body || {};

    const servidor = String(body.servidor || "").trim();
    const login = String(body.login || "").trim();
    const loginAnterior = String(body.loginAnterior || body.login_antigo || "").trim();
    const senha = String(body.senha || "").trim();
    const profile = String(body.profile || "").trim();
    const nome = String(body.nome || "").trim();
    const telefone = String(body.telefone || "").trim();
    const cpf = String(body.cpf || "").trim();

    if (!servidor || servidor === "-" || servidor === "--" || servidor.toLowerCase().includes("sem servidor")) {
      return res.status(400).json({ ok:false, erro:"Servidor não selecionado." });
    }

    if (!login) {
      return res.status(400).json({ ok:false, erro:"Login PPPoE não informado." });
    }

    if (!profile) {
      return res.status(400).json({ ok:false, erro:"PROFILE não selecionado." });
    }

    const cfg = servidorConfig(servidor);

    if (!cfg.host || !cfg.user || !cfg.pass) {
      return res.status(500).json({
        ok:false,
        erro:"Variáveis do MikroTik não configuradas para " + (cfg.key || servidor)
      });
    }

    // Confere se o profile existe no MikroTik.
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

    // Comentário usado no PPP Secret e exibido no PPP Active.
    // Deve conter somente o nome completo do cliente.
    const comentario = nome || login;

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
        mensagem:"Cliente atualizado no MikroTik: login, senha, profile e service PPPoE sincronizados.",
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
      mensagem:"Cliente criado no MikroTik com login, senha, profile e service PPPoE.",
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
app.post("/api/mikrotik/cliente-acao", async (req, res) => {
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
    const profileCadastro = String(body.profile || body.profileCadastro || "").trim();

    if (!servidor || servidor === "-" || servidor === "--" || normalizar(servidor).includes("sem servidor")) {
      return res.status(400).json({ ok:false, erro:"Servidor não selecionado." });
    }

    if (!login) {
      return res.status(400).json({ ok:false, erro:"Login PPPoE não informado." });
    }

    if (!["bloquear", "liberar", "confianca", "pagamento"].includes(acao)) {
      return res.status(400).json({ ok:false, erro:"Ação inválida." });
    }

    const cfg = servidorConfig(servidor);

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
      confiancaAte = dt.toISOString().slice(0, 10);

      mensagem = "Cliente liberado em confiança por " + dias + " dia(s), até " + confiancaAte + ".";
    }

    return res.json({
      ok:true,
      acao,
      login,
      servidor: cfg.key || servidor,
      profile: acao === "bloquear" ? "BLOQUEADO" : profileCadastro,
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
   STATUS DEDICADO DO CLIENTE - /ppp/active/print
   Online somente no servidor selecionado e com IP+MAC+UPTIME.
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

  try {
    const login = String(req.query.login || "").trim();
    const servidorNome = String(req.query.servidor || "").trim();

    if (!login) {
      return res.json({ online:false, motivo:"login_nao_informado", login:"", ip:"", mac:"", uptime:"", interface:"", profile:"", servidor:servidorNome });
    }

    if (!servidorValido(servidorNome)) {
      return res.json({ online:false, motivo:"servidor_nao_selecionado", login, ip:"", mac:"", uptime:"", interface:"", profile:"", servidor:servidorNome });
    }

    let retorno = null;
    if (typeof consultarOnlineServidor === "function") {
      retorno = await consultarOnlineServidor(servidorNome);
    }

    const ativos = Array.isArray(retorno)
      ? retorno
      : Array.isArray(retorno?.clientes)
        ? retorno.clientes
        : [];

    const loginAlvo = normalizar(login);

    const sessao = ativos.find((s) => {
      const nome = getCampo(s, ["name", "usuario", "user", "login", "loginPppoe", "pppoe", "cliente"]);
      return nome && normalizar(nome) === loginAlvo;
    });

    if (!sessao) {
      return res.json({ online:false, motivo:"login_nao_encontrado_no_ppp_active", login, ip:"", mac:"", uptime:"", interface:"", profile:"", servidor:servidorNome });
    }

    const ip = getCampo(sessao, ["address", "ip", "ipAtual", "remoteAddress", "remote-address", "remote_address"]);
    const mac = getCampo(sessao, ["callerId", "caller-id", "caller_id", "mac", "macAddress", "mac_address", "callingStationId", "calling-station-id"]);
    const uptime = getCampo(sessao, ["uptime", "tempo", "tempoOnline", "onlineTime", "sessionTime", "session-time"]);
    const iface = getCampo(sessao, ["service", "interface", "interfaceName", "interface-name", "vlan"]);
    const profile = getCampo(sessao, ["profile", "perfil", "plano", "rateLimit", "rate-limit"]);
    const servidor = getCampo(sessao, ["servidor", "server", "router", "mikrotik"]) || servidorNome;

    const online = Boolean(ip && mac && uptime);

    return res.json({
      online,
      motivo: online ? "sessao_ppp_active_confirmada" : "sessao_incompleta",
      login,
      ip: online ? ip : "",
      mac: online ? mac : "",
      uptime: online ? uptime : "",
      interface: online ? iface : "",
      profile: online ? profile : "",
      servidor
    });
  } catch (err) {
    console.error("Erro /api/cliente/status:", err);
    return res.status(500).json({ online:false, erro:true, motivo:"erro_endpoint_status_cliente", mensagem:err.message });
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

  return efiRowToConfig(r.rows[0]);
}

async function efiGerarToken(cfgParam = null) {
  const cfg = cfgParam || await efiCarregarConfig(1);
  const clientId = String(cfg?.ClientId || "").trim();
  const clientSecret = String(cfg?.ClientSecret || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("Client ID e Client Secret são obrigatórios.");
  }

  const basic = Buffer.from(clientId + ":" + clientSecret).toString("base64");

  const resp = await fetch(efiBaseUrl(cfg.Ambiente || "producao") + "/v1/authorize", {
    method: "POST",
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

  const resp = await fetch(efiBaseUrl(config.Ambiente || "producao") + pathReq, {
    method: options.method || "GET",
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
  const s = String(v || "0").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(s);
  if (!isFinite(n)) return 0;
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
  const login = String(body.login || body.loginPppoe || body.clienteLogin || body.usuario || "");
  const nome = String(body.nome || body.cliente || body.cliente_nome || "");
  const cpf = String(body.cpfCnpj || body.cpf || body.cpf_cnpj || body.documento || "");
  const vencimento = efiDateISO(body.vencimento || body.dueDate || body.due_date) || null;
  const emissao = efiDateISO(body.emissao || new Date().toISOString().slice(0, 10)) || new Date().toISOString().slice(0,10);

  const dados = {
    ...body,
    numero,
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
    JSON.stringify(dados)
  ]);

  if (!r.rows[0]) {
    r = await pool.query(`
      INSERT INTO boletos
        (numero, cliente_login, cliente_nome, cpf_cnpj, categoria, descricao, emissao, vencimento,
         valor, total, valor_pago, status, linha_digitavel, pix, link_pdf,
         efi_charge_id, efi_status, efi_conta_nome, dados, origem, atualizado_em, criado_em)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'pendente',$11,$12,$13,$14,$15,$16,$17,'Painel Fibra+ Hub Efí',NOW(),NOW())
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
      JSON.stringify(dados)
    ]);
  }

  await efiSalvarVinculoBoleto(body, detalhes);
  return r.rows[0];
}


app.post("/api/efi/boleto/criar", async (req, res) => {
  try {
    const body = req.body || {};
    const conta = Number(body.conta || 1);
    const criado = await efiCriarBoletoOneStep(body, conta);
    const row = await salvarBoletoGeradoSupabase(body, criado.detalhes, conta, criado.cfg.NomeConta || ("Conta Efí " + conta));

    return res.json({
      ok: true,
      mensagem: "Boleto criado e registrado na Efí.",
      boleto: row,
      efi: criado.detalhes
    });
  } catch (err) {
    console.error("Erro /api/efi/boleto/criar:", err);
    return res.status(500).json({ ok:false, erro:err.message });
  }
});

app.post("/api/efi/carne/criar", async (req, res) => {
  try {
    const body = req.body || {};
    const conta = Number(body.conta || 1);
    const parcelas = Array.isArray(body.parcelas) ? body.parcelas : [];
    if (!parcelas.length) return res.status(400).json({ ok:false, erro:"Nenhuma parcela informada." });

    const criados = [];
    for (const parcela of parcelas) {
      const payload = { ...body, ...parcela, conta };
      const criado = await efiCriarBoletoOneStep(payload, conta);
      const row = await salvarBoletoGeradoSupabase(payload, criado.detalhes, conta, criado.cfg.NomeConta || ("Conta Efí " + conta));
      criados.push({ boleto: row, efi: criado.detalhes });
    }

    return res.json({
      ok: true,
      mensagem: "Carnê criado na Efí como parcelas integradas.",
      total: criados.length,
      parcelas: criados
    });
  } catch (err) {
    console.error("Erro /api/efi/carne/criar:", err);
    return res.status(500).json({ ok:false, erro:err.message });
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

    const resultado = await autoProcessarPagamento({
      chargeId:autoTexto(boleto.efi_charge_id),
      numero,
      valorPago:body.valorPago || body.valor_pago || body.valor || boleto.total || boleto.valor,
      dataPagamento:body.dataPagamento || new Date().toISOString().slice(0,10),
      origem:"baixa_manual",
      eventoChave:"baixa-manual:" + numero + ":" + Date.now()
    });

    return res.json({
      ok:true,
      mensagem:"Baixa manual registrada e cliente processado no MikroTik.",
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
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dados JSONB;",
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
}
function fbClienteRow(r){
  const d = r.dados || {};
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
    profile: r.profile || d.profile || d.perfil || d.plano || ""
  };
}
function fbBoletoRow(row){
  const d = row.dados || {};
  return {
    ...d,
    id: row.id,
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

app.post("/api/clientes/salvar", async (req,res)=>{
  try{
    await fbEnsureTables();
    const body = req.body || {};
    const c = fbClienteFromAny(body);
    if(!c.login_pppoe && !c.cpf_cnpj && !c.nome) return res.status(400).json({ok:false, erro:"Cliente sem login, CPF/CNPJ ou nome."});

    const exists = await pool.query(`
      SELECT id FROM clientes
      WHERE ($1<>'' AND login_pppoe=$1)
         OR ($2<>'' AND regexp_replace(COALESCE(cpf_cnpj,''),'\\D','','g')=$2)
      ORDER BY id DESC LIMIT 1
    `,[c.login_pppoe,c.cpf_cnpj]);

    let r;
    if(exists.rows[0]){
      r = await pool.query(`
        UPDATE clientes SET login_pppoe=$1,nome=$2,cpf_cnpj=$3,telefone=$4,plano=$5,servidor=$6,profile=$7,
        dados=COALESCE(dados,'{}'::jsonb)||$8::jsonb, atualizado_em=NOW()
        WHERE id=$9 RETURNING *
      `,[c.login_pppoe,c.nome,c.cpf_cnpj,c.telefone,c.plano,c.servidor,c.profile,JSON.stringify(body),exists.rows[0].id]);
    }else{
      r = await pool.query(`
        INSERT INTO clientes (login_pppoe,nome,cpf_cnpj,telefone,plano,servidor,profile,dados,atualizado_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *
      `,[c.login_pppoe,c.nome,c.cpf_cnpj,c.telefone,c.plano,c.servidor,c.profile,JSON.stringify(body)]);
    }
    res.json({ok:true, mensagem:"Cliente salvo no Supabase.", cliente:fbClienteRow(r.rows[0])});
  }catch(err){
    console.error("Erro /api/clientes/salvar:", err);
    res.status(500).json({ok:false, erro:err.message});
  }
});

app.get("/api/clientes", async (req,res)=>{
  try{
    await fbEnsureTables();
    const r = await pool.query("SELECT * FROM clientes ORDER BY id DESC LIMIT 5000");
    res.json({ok:true,total:r.rows.length,clientes:r.rows.map(fbClienteRow)});
  }catch(err){
    console.error("Erro /api/clientes:", err);
    res.status(500).json({ok:false, erro:err.message});
  }
});

app.get("/api/boletos/cliente", async (req,res)=>{
  try{
    await fbEnsureTables();
    const login = String(req.query.login || req.query.loginPppoe || "").trim();
    const cpf = fbOnlyDigits(req.query.cpf || req.query.cpfCnpj || req.query.documento || "");
    const nome = String(req.query.nome || "").trim().toLowerCase();

    const r = await pool.query(`
      SELECT * FROM boletos
      WHERE
        ($1<>'' AND cliente_login=$1)
        OR ($2<>'' AND regexp_replace(COALESCE(cpf_cnpj,''),'\\D','','g')=$2)
        OR ($3<>'' AND lower(COALESCE(cliente_nome,''))=$3)
        OR (
          dados IS NOT NULL AND (
            ($1<>'' AND (dados->>'login'=$1 OR dados->>'loginPppoe'=$1 OR dados->>'clienteLogin'=$1))
            OR ($2<>'' AND regexp_replace(COALESCE(dados->>'cpfCnpj',dados->>'cpf',dados->>'documento',''),'\\D','','g')=$2)
          )
        )
      ORDER BY vencimento ASC NULLS LAST, id DESC
    `,[login,cpf,nome]);
    res.json({ok:true,total:r.rows.length,boletos:r.rows.map(fbBoletoRow)});
  }catch(err){
    console.error("Erro /api/boletos/cliente:", err);
    res.status(500).json({ok:false, erro:err.message});
  }
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

  const profile =
    autoPrimeiro(cliente, ["profile"]) ||
    autoPrimeiro(cd, ["profile","perfil","profileServidor","planoVelocidade","velocidade"]) ||
    autoPrimeiro(cliente, ["plano"]) ||
    autoPrimeiro(cd, ["plano"]);

  return { login, servidor, profile };
}

async function autoBuscarClienteDoBoleto(boleto) {
  const bd = autoDados(boleto);
  const login =
    autoPrimeiro(boleto, ["cliente_login"]) ||
    autoPrimeiro(bd, ["login","loginPppoe","clienteLogin","usuario","pppoe"]);

  const cpf = autoDigitos(
    autoPrimeiro(boleto, ["cpf_cnpj"]) ||
    autoPrimeiro(bd, ["cpfCnpj","cpf","cnpj","documento"])
  );

  const nome =
    autoPrimeiro(boleto, ["cliente_nome"]) ||
    autoPrimeiro(bd, ["nome","cliente","nomeCliente"]);

  const r = await pool.query(`
    SELECT *
    FROM clientes
    WHERE
      ($1 <> '' AND (
        login_pppoe=$1 OR pppoe=$1 OR dados->>'login'=$1 OR dados->>'loginPppoe'=$1
      ))
      OR ($2 <> '' AND regexp_replace(COALESCE(cpf_cnpj,cpf,dados->>'cpfCnpj',dados->>'cpf',''),'\\D','','g')=$2)
      OR ($3 <> '' AND lower(COALESCE(nome,dados->>'nome',dados->>'cliente',''))=lower($3))
    ORDER BY id DESC
    LIMIT 1
  `, [login, cpf, nome]);

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

  const cfg = servidorConfig(servidor);
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
        confianca_ate='',
        dados=COALESCE(dados,'{}'::jsonb) || $1::jsonb
      WHERE id=$2
    `, [
      JSON.stringify({
        status:"ativo",
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
  const campos = autoClienteCampos(cliente, boleto);
  const chave = "bloqueio:" + cliente.id + ":" + boleto.numero;
  const inicio = await autoEventoIniciar(chave, "bloqueio", {
    boleto_numero:boleto.numero,
    cliente_login:campos.login,
    servidor:campos.servidor
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
        dados=COALESCE(dados,'{}'::jsonb) || $1::jsonb
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

  const dias = Math.max(0, Number(process.env.BLOQUEIO_DIAS_APOS_VENCIMENTO || 1));
  const limite = Math.max(1, Math.min(500, Number(process.env.BLOQUEIO_MAX_CLIENTES_POR_EXECUCAO || 100)));

  const candidatos = await pool.query(`
    SELECT DISTINCT ON (c.id)
      c.*,
      b.id AS boleto_id,
      b.numero AS boleto_numero,
      b.cliente_login AS boleto_login,
      b.cliente_nome AS boleto_cliente_nome,
      b.cpf_cnpj AS boleto_cpf_cnpj,
      b.vencimento AS boleto_vencimento,
      b.status AS boleto_status,
      b.dados AS boleto_dados
    FROM clientes c
    JOIN boletos b ON (
      (COALESCE(c.login_pppoe,c.pppoe,c.dados->>'loginPppoe',c.dados->>'login','') <> ''
       AND COALESCE(c.login_pppoe,c.pppoe,c.dados->>'loginPppoe',c.dados->>'login','')
         = COALESCE(b.cliente_login,b.dados->>'loginPppoe',b.dados->>'login',''))
      OR
      (regexp_replace(COALESCE(c.cpf_cnpj,c.cpf,c.dados->>'cpfCnpj',c.dados->>'cpf',''),'\\D','','g') <> ''
       AND regexp_replace(COALESCE(c.cpf_cnpj,c.cpf,c.dados->>'cpfCnpj',c.dados->>'cpf',''),'\\D','','g')
         = regexp_replace(COALESCE(b.cpf_cnpj,b.dados->>'cpfCnpj',b.dados->>'cpf',''),'\\D','','g'))
    )
    WHERE
      lower(COALESCE(b.status,'pendente')) NOT IN ('pago','paid','cancelado','canceled')
      AND b.vencimento IS NOT NULL
      AND b.vencimento < (CURRENT_DATE - $1::integer)
      AND (
        COALESCE(c.confianca_ate,'') = ''
        OR c.confianca_ate !~ '^\\d{4}-\\d{2}-\\d{2}$'
        OR c.confianca_ate::date < CURRENT_DATE
      )
    ORDER BY c.id, b.vencimento ASC
    LIMIT $2
  `, [dias, limite]);

  const resultados = [];

  for (const row of candidatos.rows) {
    const boleto = {
      id:row.boleto_id,
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



app.get("/api/clientes/buscar", async (req, res) => {
  try {
    await fbEnsureTables();
    const chave = String(req.query.chave || req.query.login || req.query.cpf || req.query.id || "").trim();
    if (!chave) return res.status(400).json({ok:false, erro:"Chave do cliente não informada."});

    const somenteDigitos = chave.replace(/\D/g, "");
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
if (process.env.VERCEL) {
  initDb().catch(err => console.error("Erro ao iniciar banco:", err.message));
  module.exports = app;
} else {
  initDb().finally(() => server.listen(PORT, () => console.log("Fibra+ Hub 2 Servidores rodando na porta " + PORT)));
}
