function entrar(){
 const login=document.getElementById('login').value;
 const senha=document.getElementById('senha').value;
 document.getElementById('msg').innerText =
 login && senha ? 'Central preparada para conexão com Supabase.' : 'Informe login e senha.';
}