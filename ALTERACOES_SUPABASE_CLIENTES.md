# Atualização: clientes com Supabase como fonte única

- Removido o uso de `localStorage` e `sessionStorage` para listas, seleção e edição de clientes.
- A navegação entre lista, detalhes e cadastro usa o ID/chave do cliente na URL.
- Listagem, busca, cadastro, importação e atualização de clientes usam a API ligada ao Supabase.
- O cache de clientes existe somente em memória durante a página atual.
- Boletos, Efí, MikroTik, bloqueio/desbloqueio e suporte a cadastros com logins PPPoE distintos foram preservados.
- As chaves `cliente_efi_conta_id` e `cliente_efi_conta_nome` foram mantidas porque pertencem à seleção de conta Efí, não à persistência cadastral de clientes.
