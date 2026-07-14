# Fibra+ Hub

## Histórico consolidado das alterações

Este documento reúne as alterações implementadas no projeto Fibra+ Hub. O Supabase permanece como fonte oficial dos dados, sem listas paralelas de clientes como fonte principal.

### Clientes e cadastro
- Cadastro, listagem, busca e contadores conectados ao Supabase.
- Abertura do cliente pelo identificador do cadastro.
- Preenchimento completo dos dados e correção do resumo lateral.
- Pesquisa de clientes por lupa.
- Suporte a vários pontos para o mesmo CPF, diferenciados pelo login PPPoE e pelo `cliente_id`.
- CPF obrigatório, formatado como `000.000.000-00` e validado pelos dígitos verificadores.

### Botões de gravação
- **Salvar somente no Fibra+ Hub:** exige nome, login PPPoE e senha; salva no Supabase sem exigir Servidor/POP ou Profile e sem chamar o MikroTik.
- **Salvar no Fibra+ Hub + MikroTik:** salva no Supabase e cria ou atualiza o PPPoE Secret no servidor selecionado.
- Comment do PPPoE no padrão `NOME COMPLETO: CPF`.

### MikroTik
- Criação e atualização de PPPoE Secret sem duplicar o mesmo login.
- Bloqueio com Profile `BLOQUEADO` e preservação do Profile normal.
- Desbloqueio e restauração do Profile após pagamento.
- Sincronização do Profile com o Supabase e a aba Servidor.
- Exclusão pelo botão existente: remove o Secret do servidor selecionado e depois remove somente o ponto correspondente do Supabase.

### Efí e financeiro
- Correção da conversão monetária: `2,15` e `2.15` são enviados como 215 centavos.
- Boleto vinculado ao `cliente_id` do ponto, aceitando UUID como texto.
- Baixa automática e desbloqueio do PPPoE correspondente ao boleto pago.
- Histórico financeiro separado por ponto.
- Segunda via, linha digitável e Pix associados à cobrança Efí correspondente.
- Proteção contra duplicidade antes de criar a cobrança na Efí:
  - mensalidade: bloqueia outra cobrança do mesmo ponto no mesmo mês, mesmo que a anterior esteja paga;
  - cobrança avulsa: compara ponto, vencimento, categoria, descrição e valor;
  - boletos cancelados ou estornados não impedem nova geração;
  - trava no PostgreSQL por `cliente_id` impede duplicidade por cliques ou requisições simultâneas;
  - carnês são validados integralmente antes da primeira parcela ser criada.

### Regras mantidas
- Não criar páginas novas ou scripts paralelos.
- Alterar somente os arquivos necessários.
- Manter o layout, o tema escuro e o menu atuais.
- Tratar cada ponto como cadastro financeiro e técnico independente.
