// Saved seed + simulation time: irregular weather without frame-rate randomness.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function weatherHash(value){let n=value>>>0;n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return (n^(n>>>16))>>>0}
const random=(seed,k)=>weatherHash((seed>>>0)^Math.imul(k+1,2654435761))/4294967296;
const smooth=t=>t*t*(3-2*t);
function noise(seed,time,period,salt){const k=Math.floor(time/period),t=smooth(time/period-k);return random(seed,k+salt)*(1-t)+random(seed,k+salt+1)*t}
export function windAt(weather,clock=0){
  if(!weather?.enabled)return {x:0,y:0,speed:0,gust:0,angle:0};
  const seed=weather.seed>>>0,time=Math.max(0,clock),angle=random(seed,41)*Math.PI*2+(noise(seed,time,71,80)-.5)*1.6;
  const speed=.7+noise(seed,time,53,150)*3.6,gust=(noise(seed,time,4.3,400)-.5)*2.3;
  const actual=clamp(speed+gust,.15,6),turn=(noise(seed,time,6.7,700)-.5)*.24;
  return {x:Math.cos(angle+turn)*actual,y:Math.sin(angle+turn)*actual,speed:actual,gust,angle:angle+turn};
}
