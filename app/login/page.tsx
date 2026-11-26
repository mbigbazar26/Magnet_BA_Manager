export default async function Login({searchParams}:{searchParams:Promise<{error?:string}>}) {
 const error=(await searchParams).error
 return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#eff4ef',fontFamily:'Inter,system-ui,sans-serif',color:'#193b2a'}}>
 <form method="post" action="/api/session" style={{background:'white',padding:36,border:'1px solid #cddccf',borderRadius:16,width:'min(90vw,420px)',display:'grid',gap:16}}>
 <small>MANCHERIKALAM BIGBAZAR</small><h1 style={{margin:0}}>Messaging desk</h1>
 <label htmlFor="password">Operator password</label><input id="password" name="password" type="password" autoComplete="current-password" required style={{padding:12,border:'1px solid #859e90',borderRadius:6}}/>
 {error && <span role="alert">Check the operator password and try again.</span>}
 <button style={{background:'#175638',color:'white',padding:13,border:0,borderRadius:6}}>Sign in</button><small>Your local password is in the app folder under .local/operator-password.txt.</small></form></main>
}
