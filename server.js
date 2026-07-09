
const express = require("express");
const cors = require("cors");
const path = require("path");
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

  if (nome.includes("ARMANDO")) {
    return {
      key: "armando",
      host: process.env.MIKROTIK_ARMANDO_HOST,
      port: process.env.MIKROTIK_ARMANDO_PORT || 8728,
      user: process.env.MIKROTIK_ARMANDO_USER,
      pass: process.env.MIKROTIK_ARMANDO_PASS
    };
  }

  return {
    key: "colonia",
    host: process.env.MIKROTIK_COLONIA_HOST,
    port: process.env.MIKROTIK_COLONIA_PORT || 8728,
    user: process.env.MIKROTIK_COLONIA_USER,
    pass: process.env.MIKROTIK_COLONIA_PASS
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

app.get("/api/servidores",(req,res)=>res.json(servidores));

app.get("/api/clientes", async (req,res)=>{
  try {
    const result = await pool.query("SELECT * FROM clientes ORDER BY id DESC");
    res.json(result.rows);
  } catch(e) { res.status(500).json({ erro:e.message }); }
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



/* EFI BACKEND CONTA 1 */
let efiConta1Config = {
  nomeConta: process.env.EFI1_NOME_CONTA || "",
  documento: process.env.EFI1_DOCUMENTO || "",
  ambiente: process.env.EFI1_AMBIENTE || "producao",
  clientId: process.env.EFI1_CLIENT_ID || "",
  clientSecret: process.env.EFI1_CLIENT_SECRET || "",
  webhook: process.env.EFI1_WEBHOOK || ""
};

function efiBaseUrl(ambiente) {
  return String(ambiente || "").toLowerCase().includes("homolog")
    ? "https://cobrancas-h.api.efipay.com.br"
    : "https://cobrancas.api.efipay.com.br";
}

async function efiGerarToken(config) {
  const clientId = String(config.clientId || "").trim();
  const clientSecret = String(config.clientSecret || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("Client ID e Client Secret são obrigatórios.");
  }

  const basic = Buffer.from(clientId + ":" + clientSecret).toString("base64");
  const resp = await fetch(efiBaseUrl(config.ambiente) + "/v1/authorize", {
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

app.post("/api/efi/salvar-config", async (req, res) => {
  try {
    const body = req.body || {};
    const conta = Number(body.conta || 1);

    if (conta !== 1) {
      return res.json({ ok:true, mensagem:"Conta Efí " + conta + " mantida para integração futura." });
    }

    efiConta1Config = {
      nomeConta: String(body.NomeConta || body.nomeConta || "").trim(),
      documento: String(body.Documento || body.documento || "").trim(),
      ambiente: String(body.Ambiente || body.ambiente || "producao").trim(),
      clientId: String(body.ClientId || body.clientId || "").trim(),
      clientSecret: String(body.ClientSecret || body.clientSecret || "").trim(),
      webhook: String(body.Webhook || body.webhook || "").trim()
    };

    res.json({ ok:true, mensagem:"Conta Efí 1 salva no backend." });
  } catch (err) {
    res.status(500).json({ ok:false, erro:err.message });
  }
});

app.post("/api/efi/testar-conexao", async (req, res) => {
  try {
    const body = req.body || {};
    const conta = Number(body.conta || 1);

    if (conta !== 1) {
      return res.status(400).json({ ok:false, erro:"Conta Efí 2 ainda não integrada." });
    }

    const cfg = {
      nomeConta: String(body.NomeConta || efiConta1Config.nomeConta || "").trim(),
      documento: String(body.Documento || efiConta1Config.documento || "").trim(),
      ambiente: String(body.Ambiente || efiConta1Config.ambiente || "producao").trim(),
      clientId: String(body.ClientId || efiConta1Config.clientId || "").trim(),
      clientSecret: String(body.ClientSecret || efiConta1Config.clientSecret || "").trim(),
      webhook: String(body.Webhook || efiConta1Config.webhook || "").trim()
    };

    const token = await efiGerarToken(cfg);
    efiConta1Config = cfg;

    res.json({
      ok:true,
      mensagem:"Conexão Efí OK. Token OAuth gerado.",
      token_type: token.token_type || "Bearer",
      expires_in: token.expires_in || null
    });
  } catch (err) {
    console.error("Erro /api/efi/testar-conexao:", err);
    res.status(500).json({ ok:false, erro:err.message });
  }
});

app.get("/api/efi/boletos/teste", async (req, res) => {
  try {
    const token = await efiGerarToken(efiConta1Config);
    res.json({
      ok:true,
      mensagem:"OAuth Efí OK para Conta 1.",
      observacao:"Para consultar/gerar boletos reais, a próxima etapa é escolher o endpoint Efí de cobranças compatível com OAuth sem certificado.",
      token_type: token.token_type || "Bearer",
      expires_in: token.expires_in || null
    });
  } catch (err) {
    console.error("Erro /api/efi/boletos/teste:", err);
    res.status(500).json({ ok:false, erro:err.message });
  }
});



/* EFI STATUS INTEGRACAO */
app.get("/api/efi/status", async (req, res) => {
  try {
    const integrada = Boolean(
      efiConta1Config &&
      String(efiConta1Config.clientId || "").trim() &&
      String(efiConta1Config.clientSecret || "").trim()
    );

    return res.json({
      ok: true,
      integrada,
      conta: integrada ? {
        nomeConta: efiConta1Config.nomeConta || "Conta Efí 1",
        documento: efiConta1Config.documento || "",
        ambiente: efiConta1Config.ambiente || "producao"
      } : null
    });
  } catch (err) {
    return res.status(500).json({ ok:false, integrada:false, erro:err.message });
  }
});





/* EFI BOLETO IMPORTADO DIRETO */
function efiNormalizarStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("paid") || s.includes("pago") || s.includes("settled") || s.includes("settlement")) return "Pago";
  if (s.includes("waiting") || s.includes("pend") || s.includes("unpaid") || s.includes("new")) return "Aguardando pagamento";
  if (s.includes("cancel")) return "Cancelado";
  if (s.includes("expired") || s.includes("venc")) return "Vencido";
  if (s.includes("link") || s.includes("active")) return "Registrado na Efí";
  return status || "Registrado na Efí";
}

function somenteNumeros(v) {
  return String(v || "").replace(/\D/g, "");
}

function dinheiroCentavos(v) {
  const s = String(v || "0").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(s);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

function dataISO(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}

function addDias(iso, dias) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0,10);
}

function efiConfigFromBody(body) {
  const cfg = body.efiConfig || body.config || {};
  return {
    nomeConta: String(cfg.NomeConta || cfg.nomeConta || efiConta1Config.nomeConta || "").trim(),
    documento: String(cfg.Documento || cfg.documento || efiConta1Config.documento || "").trim(),
    ambiente: String(cfg.Ambiente || cfg.ambiente || efiConta1Config.ambiente || "producao").trim(),
    clientId: String(cfg.ClientId || cfg.clientId || efiConta1Config.clientId || "").trim(),
    clientSecret: String(cfg.ClientSecret || cfg.clientSecret || efiConta1Config.clientSecret || "").trim(),
    webhook: String(cfg.Webhook || cfg.webhook || efiConta1Config.webhook || "").trim()
  };
}

async function efiRequestConta1(path, options = {}, cfgOverride = null) {
  const cfg = cfgOverride || efiConta1Config;
  const token = await efiGerarToken(cfg);
  const accessToken = token.access_token;

  if (!accessToken) throw new Error("Token Efí sem access_token.");

  const resp = await fetch(efiBaseUrl(cfg.ambiente) + path, {
    method: options.method || "GET",
    headers: {
      "Authorization": "Bearer " + accessToken,
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

function extrairArrayCobrancas(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.charges)) return json.charges;
  if (Array.isArray(json.items)) return json.items;
  return [];
}

function getDeep(obj, paths) {
  for (const path of paths) {
    const parts = path.split(".");
    let cur = obj;
    for (const p of parts) cur = cur && cur[p] !== undefined ? cur[p] : undefined;
    if (cur !== undefined && cur !== null && String(cur).trim() !== "") return cur;
  }
  return "";
}

function extrairDadosBoletoEfi(json) {
  const data = json && (json.data || json);
  const charge = data.charge || data;

  const linhaDigitavel = getDeep(data, [
    "barcode", "digitable_line", "linha_digitavel", "banking_billet.barcode",
    "banking_billet.digitable_line", "payment.banking_billet.barcode",
    "payment.banking_billet.digitable_line", "billet_link"
  ]) || getDeep(charge, ["barcode", "digitable_line", "linha_digitavel"]);

  const pix = getDeep(data, [
    "pixCopiaECola", "pix_copia_e_cola", "qrcode", "qr_code",
    "pix.qrcode", "pix.qr_code", "pix.copy_paste",
    "payment.pix.qrcode", "payment.pix.copy_paste"
  ]) || getDeep(charge, ["pixCopiaECola", "pix_copia_e_cola", "qrcode", "qr_code"]);

  const link = getDeep(data, [
    "pdf.charge", "pdf.carnet", "link", "payment_url", "url",
    "payment.banking_billet.link", "banking_billet.link", "billet_link"
  ]) || getDeep(charge, ["link", "payment_url", "url"]);

  const status = getDeep(data, ["status", "situacao"]) || getDeep(charge, ["status", "situacao"]);

  return {
    situacao_efi: efiNormalizarStatus(status),
    linha_digitavel: String(linhaDigitavel || ""),
    pix_copia_cola: String(pix || ""),
    link_boleto: String(link || ""),
    raw: data
  };
}

function pontuarCobranca(item, alvo) {
  let pontos = 0;

  const id = String(getDeep(item, ["charge_id", "id", "custom_id", "metadata.custom_id", "numero"]) || "").trim();
  const cliente = String(getDeep(item, ["customer.name", "name", "cliente", "client.name"]) || "").toLowerCase();
  const doc = somenteNumeros(getDeep(item, ["customer.cpf", "customer.cnpj", "cpf", "cnpj", "cpf_cnpj"]));
  const venc = dataISO(getDeep(item, ["expire_at", "due_date", "vencimento", "payment.banking_billet.expire_at"]));
  const valor = Number(getDeep(item, ["total", "value", "amount", "payment.banking_billet.value"]) || 0);

  const idAlvo = String(alvo.numero || "").trim();
  const nomeAlvo = String(alvo.cliente || "").toLowerCase();
  const docAlvo = somenteNumeros(alvo.cpf || alvo.cpf_cnpj || "");
  const vencAlvo = dataISO(alvo.vencimento || "");
  const valorAlvo = dinheiroCentavos(alvo.valor || alvo.valorPago || "");

  if (idAlvo && id === idAlvo) pontos += 100;
  if (docAlvo && doc && doc === docAlvo) pontos += 60;
  if (nomeAlvo && cliente && (cliente.includes(nomeAlvo) || nomeAlvo.includes(cliente))) pontos += 45;
  if (vencAlvo && venc && venc === vencAlvo) pontos += 35;
  if (valorAlvo && valor) {
    const itemCentavos = valor > 100000 ? Math.round(valor) : Math.round(Number(valor) * 100);
    if (Math.abs(itemCentavos - valorAlvo) <= 2) pontos += 35;
  }

  return pontos;
}

app.post("/api/efi/boleto-importado/consultar", async (req, res) => {
  try {
    const body = req.body || {};
    const cfg = efiConfigFromBody(body);

    if (!cfg.clientId || !cfg.clientSecret) {
      return res.status(400).json({ ok:false, erro:"Conta Efí 1 não configurada. Informe Client ID e Client Secret." });
    }

    efiConta1Config = cfg;

    const numero = String(body.numero || body.id || body.charge_id || body.chargeId || "").trim();
    const emissao = dataISO(body.emissao || body.dataEmissao || "");
    const vencimento = dataISO(body.vencimento || "");
    const cpf = somenteNumeros(body.cpf || body.cpf_cnpj || "");

    // 1) Se o número importado for charge_id real, pega direto.
    if (numero) {
      const tentativas = [
        "/v1/charge/" + encodeURIComponent(numero),
        "/v1/charge/" + encodeURIComponent(numero) + "/detail"
      ];

      for (const path of tentativas) {
        try {
          const r = await efiRequestConta1(path, {}, cfg);
          if (r.ok) {
            const dados = extrairDadosBoletoEfi(r.json);
            return res.json({ ok:true, encontrado:true, fonte:path, ...dados });
          }
        } catch(e) {}
      }
    }

    // 2) Busca em lista por emissão e vencimento. ReceitaNet muitas vezes não importa o charge_id.
    const datasBase = [];
    if (emissao) datasBase.push(emissao);
    if (vencimento) datasBase.push(vencimento);
    if (!datasBase.length) datasBase.push(new Date().toISOString().slice(0,10));

    let melhor = null;
    let melhorScore = 0;
    let detalheErro = null;

    for (const dataBase of datasBase) {
      const begin = addDias(dataBase, -45);
      const end = addDias(dataBase, 45);

      const caminhos = [
        `/v1/charges?begin_date=${begin}&end_date=${end}`,
        `/v1/charge?begin_date=${begin}&end_date=${end}`,
        `/v1/charges?begin_date=${begin}&end_date=${end}&status=all`
      ];

      for (const path of caminhos) {
        try {
          const r = await efiRequestConta1(path, {}, cfg);
          if (!r.ok) {
            detalheErro = r.json;
            continue;
          }

          const lista = extrairArrayCobrancas(r.json);
          for (const item of lista) {
            const score = pontuarCobranca(item, body);
            if (score > melhorScore) {
              melhorScore = score;
              melhor = item;
            }
          }
        } catch(e) {
          detalheErro = e.message;
        }
      }
    }

    if (melhor && melhorScore >= 35) {
      const id = getDeep(melhor, ["charge_id", "id"]);
      if (id) {
        const detalhePaths = [
          "/v1/charge/" + encodeURIComponent(id),
          "/v1/charge/" + encodeURIComponent(id) + "/detail"
        ];

        for (const path of detalhePaths) {
          try {
            const d = await efiRequestConta1(path, {}, cfg);
            if (d.ok) {
              const dados = extrairDadosBoletoEfi(d.json);
              return res.json({ ok:true, encontrado:true, fonte:"busca-lista+detalhe", score:melhorScore, ...dados });
            }
          } catch(e) {}
        }
      }

      const dados = extrairDadosBoletoEfi(melhor);
      return res.json({ ok:true, encontrado:true, fonte:"busca-lista", score:melhorScore, ...dados });
    }

    return res.json({
      ok:true,
      encontrado:false,
      situacao_efi:"Integrado na Efí - boleto não localizado",
      linha_digitavel:"",
      pix_copia_cola:"",
      link_boleto:"",
      detalhe: detalheErro
    });
  } catch (err) {
    console.error("Erro /api/efi/boleto-importado/consultar:", err);
    return res.status(500).json({ ok:false, erro:err.message });
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



