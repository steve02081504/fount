c=[[]];for(s of` 18@2:1,2; 16:2@2:1,2; 14@2:2@2:1,3; 9@3 2@2:2@2:1,8; 16:2 2:1,1; 5@16,4`.split`;`)for([e,n]=s.split`,`,o=[...o=e.match(/.\d+/g).map(m=>m[0].repeat(m.slice(1))),...o.reverse()];n--;c.push(...o.map(x=>`color:#0${x<'@'?'ff':11}`)))c[0]+=`%c${o.join`%c`}
`
c