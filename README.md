[README.txt](https://github.com/user-attachments/files/29725093/README.txt)
Fibra+ Hub 2 Servidores

Use o mesmo Render.

Variáveis:
PANEL_TOKEN=fibra2026
DATABASE_URL=postgresql://...

No MikroTik Colônia, adicione no JSON:
"servidor":"colonia"

No MikroTik Armando Mendes, adicione:
"servidor":"armando"

Login:
admin / admin

Atualização: card CPU Média removido/substituído por Receita calculada pelos clientes ativos cadastrados no PostgreSQL.

Atualização: campo CEP no cadastro com preenchimento automático via ViaCEP.

Atualização endereço completo: número da casa, complemento e ponto de referência no cadastro e PostgreSQL.

Atualização: campo Servidor do Cliente no cadastro, salvando em clientes.servidor e exibindo em Clientes.

Correção: Campo Servidor do Cliente visível no cadastro e em Clientes.


Atualização PPPoE automático:
Variáveis necessárias no Render:
MIKROTIK_COLONIA_HOST=780f06cb8ccd.sn.mynetname.net
MIKROTIK_COLONIA_PORT=8728
MIKROTIK_COLONIA_USER=fibrahub
MIKROTIK_COLONIA_PASS=91905532

MIKROTIK_ARMANDO_HOST=d56a0ca82138.sn.mynetname.net
MIKROTIK_ARMANDO_PORT=8728
MIKROTIK_ARMANDO_USER=fibrahub
MIKROTIK_ARMANDO_PASS=25270850

Teste:
GET /api/mikrotik/test?servidor=COLONIA%20ANTONIO%20ALEIXO
GET /api/mikrotik/test?servidor=ARMANDO%20MENDES


Atualização:
- Ao cadastrar, o sistema cria PPP Profile automaticamente se não existir.
- Rate-limit automático: 300 Mega = 300M/300M, 600 Mega = 600M/600M, 1 Giga = 1000M/1000M.
- Página de dados do cliente: cliente.html?id=ID.
- Botão Ver e Editar em Clientes.
- Edição de cliente via PUT /api/clientes/:id.
- Removida duplicidade de Ponto de referência no cadastro.

Atualização:
- Campo Acesso Remoto do roteador no cadastro.
- Botão Acesso Remoto em Clientes.
- Coluna clientes.acesso_remoto no PostgreSQL.

Atualização funcional:
- Botão Bloquear em Dados do Cliente.
- Botão Desbloquear em Dados do Cliente.
- Botão Liberar em Confiança em Dados do Cliente.
- Rotas:
  POST /api/clientes/:id/bloquear
  POST /api/clientes/:id/desbloquear
  POST /api/clientes/:id/confianca
- Executa enable/disable no PPP Secret do MikroTik correto usando o servidor do cliente.

Correção:
- Se o PPP Profile/plano já existir no MikroTik, o sistema ignora esse erro e continua criando o PPPoE.
- Corrige erro: "profile with the same name already exists".

Correção PPPoE:
- Campo PPPoE aceita @ normalmente.
- Exemplos aceitos: cliente@anet, joao@fibra, maria@armando.
- O sistema não corta nem altera o texto após o @.

Correção:
- Adicionada função acaoPPPoECliente no server.js.
- Corrige erro: acaoPPPoECliente is not defined.
- Bloquear, desbloquear e liberar em confiança funcionam usando o PPPoE com @.

Atualização status em Dados do Cliente:
- Mostra 🟢 Online se estiver em /ppp active.
- Mostra 🔴 Offline se o PPP Secret existe mas não está conectado.
- Mostra 🟡 Bloqueado se o PPP Secret está disabled.
- Mostra ⭐ Em confiança se cliente estiver liberado em confiança.
- Rota: GET /api/clientes/:id/status-mikrotik

Correção bloqueio imediato:
- Ao clicar Bloquear, o sistema executa:
  /ppp secret disable
  /ppp active remove
- Assim o cliente perde o acesso à internet imediatamente.

Correção final do bloqueio imediato:
- O botão Bloquear consulta /ppp active pelo usuário PPPoE.
- Remove a sessão ativa pelo .id retornado pela API.
- Depois desabilita o PPP Secret.
- Resultado: cliente perde internet imediatamente e não reconecta.

Atualização migração de servidor:
- Ao editar o cliente e trocar o Servidor:
  1. Derruba sessão ativa no servidor antigo.
  2. Remove PPP Secret do servidor antigo.
  3. Cria PPP Profile se precisar no novo servidor.
  4. Cria PPP Secret no novo servidor.
  5. Atualiza o banco.
- Também trata troca de usuário PPPoE no mesmo servidor.

Atualização acesso remoto pelo IP PPPoE:
- Em Dados do Cliente aparece o bloco Acesso Remoto.
- O sistema consulta /ppp active no MikroTik correto.
- Se o cliente estiver online, mostra:
  🌐 Abrir HTTP
  🔒 Abrir HTTPS
  🖥️ Abrir Winbox
- Removidos botões de copiar IP e atualizar IP.
- Rota adicionada: GET /api/clientes/:id/acesso-remoto

Correção final:
- Os botões 🌐 Abrir HTTP, 🔒 Abrir HTTPS e 🖥️ Abrir Winbox aparecem dentro do bloco Status de Conexão.
- Eles aparecem somente quando o status é Online ou Em confiança e existe IP PPPoE ativo.
- Removido bloco separado de Acesso Remoto.

Atualização proxy remoto dinâmico:
- Novo acesso: /remoto/:id
- O painel busca o cliente no PostgreSQL.
- Consulta o MikroTik correto para pegar o IP PPPoE ativo.
- Usa /tool fetch do MikroTik para buscar a página HTTP do roteador do cliente.
- Não precisa criar proxy por cliente.
- Botão adicionado: 🌐 Acessar pelo Painel.
Observação: funciona melhor em HTTP simples. Páginas complexas com JavaScript podem exigir VPN do técnico ou proxy mais avançado.
