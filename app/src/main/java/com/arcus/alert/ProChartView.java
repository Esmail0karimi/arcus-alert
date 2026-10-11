package com.arcus.alert;

import android.content.Context;
import android.graphics.Color;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * WebView chart engine backed by TradingView Lightweight Charts.
 * The legacy ChartView remains in the project as a safe rollback/fallback.
 */
public class ProChartView extends WebView {
    private ChartView.OnPriceTapListener priceTapListener;
    private ChartView.OnAlertDragListener alertDragListener;
    private ChartView.OnChartSwipeListener chartSwipeListener;
    private final ArrayList<String> pendingJs = new ArrayList<>();
    private boolean pageReady = false;
    private String currentSymbol = "";

    public ProChartView(Context context) {
        super(context);
        setBackgroundColor(Color.rgb(9, 15, 27));
        setLayerType(WebView.LAYER_TYPE_HARDWARE, null);
        WebSettings settings = getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        addJavascriptInterface(new Bridge(), "ArcusNative");
        setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                pageReady = true;
                for (String js : new ArrayList<>(pendingJs)) evaluateJavascript(js, null);
                pendingJs.clear();
            }
        });
        loadDataWithBaseURL("https://appassets.androidplatform.net/", HTML,
                "text/html", "UTF-8", null);
    }

    public void setOnPriceTapListener(ChartView.OnPriceTapListener listener) { priceTapListener = listener; }
    public void setOnAlertDragListener(ChartView.OnAlertDragListener listener) { alertDragListener = listener; }
    public void setOnChartSwipeListener(ChartView.OnChartSwipeListener listener) { chartSwipeListener = listener; }

    public void setCandles(List<ChartView.Candle> candles) {
        JSONArray data = new JSONArray();
        if (candles != null) for (ChartView.Candle candle : candles) {
            try {
                JSONObject item = new JSONObject();
                item.put("time", candle.time > 100000000000L ? candle.time / 1000L : candle.time);
                item.put("open", candle.open);
                item.put("high", candle.high);
                item.put("low", candle.low);
                item.put("close", candle.close);\n                item.put("volume", candle.volume);
                data.put(item);
            } catch (Exception ignored) { }
        }
        runChartJs("setCandles(" + data.toString() + ");");
    }

    public void setAlertPrices(List<Double> prices) {
        JSONArray data = new JSONArray();
        if (prices != null) for (Double price : prices) if (price != null) data.put(price);
        runChartJs("setAlerts(" + data.toString() + ");");
    }

    public void setSymbol(String symbol) {
        currentSymbol = symbol == null ? "" : symbol;
        runChartJs("setSymbol(" + JSONObject.quote(currentSymbol) + ");");
    }

    public void setIndicator(String indicator, boolean enabled) {
        runChartJs("setIndicator(" + JSONObject.quote(indicator) + "," + enabled + ");");
    }

    public void setChartType(String type) {
        runChartJs("setChartType(" + JSONObject.quote(type) + ");");
    }

    public void setDrawingTool(String tool) {
        runChartJs("setDrawingTool(" + JSONObject.quote(tool) + ");");
    }

    public void resetView() { runChartJs("fitContent();"); }
    public void zoomHorizontal(float factor) { runChartJs("zoomTime(" + factor + ");"); }
    public void zoomVertical(float factor) { runChartJs("zoomPrice(" + factor + ");"); }

    private void runChartJs(String code) {
        String js = "if(window.ArcusChart){window.ArcusChart." + code + "}";
        if (pageReady) evaluateJavascript(js, null); else pendingJs.add(js);
    }

    private final class Bridge {
        @JavascriptInterface public void onPriceTap(final double price) {
            post(() -> { if (priceTapListener != null && price > 0) priceTapListener.onPriceTap(price); });
        }
        @JavascriptInterface public void onAlertMoved(final int index, final double price) {
            post(() -> { if (alertDragListener != null && price > 0) alertDragListener.onMoved(index, price); });
        }
        @JavascriptInterface public void onAlertSelected(final int index) {
            post(() -> { if (alertDragListener != null) alertDragListener.onSelected(index); });
        }
        @JavascriptInterface public void onChartSwipe(final int direction) {
            post(() -> { if (chartSwipeListener != null) chartSwipeListener.onSwipe(direction); });
        }
    }

    private static final String HTML = """
<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#090f1b;color:#dce6f5;font-family:Arial,sans-serif}
#root{height:100%;display:flex;flex-direction:column;background:#090f1b}
#hud{height:27px;flex:none;padding:5px 8px;font-size:10px;color:#9aabc3;white-space:nowrap;overflow:hidden}
#mainWrap{position:relative;flex:1;min-height:150px}
#main{position:absolute;inset:0}
#rsi{height:0;flex:none;overflow:hidden;border-top:1px solid #26364e}
#overlay{position:absolute;inset:0;pointer-events:none;z-index:5}
#drawCanvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
#alertLayer{position:absolute;inset:0;pointer-events:none}
.alertLine{position:absolute;left:0;right:0;height:22px;transform:translateY(-11px);pointer-events:auto;touch-action:none}
.alertLine:before{content:'';position:absolute;left:0;right:0;top:10px;border-top:1px dashed #4aaaff}
.alertTag{position:absolute;right:2px;top:1px;background:#245b87;color:#fff;border-radius:4px;padding:3px 5px;font-size:9px}
#crossPlus{display:none;position:absolute;right:4px;width:25px;height:25px;border:0;border-radius:50%;background:#34d399;color:#071b17;font-size:20px;font-weight:bold;z-index:8;padding:0}
#legend{position:absolute;left:5px;top:4px;z-index:6;font-size:9px;color:#d6e2f2;background:#0d1726cc;padding:4px 6px;border-radius:4px;pointer-events:none}
#status{position:absolute;left:8px;bottom:4px;z-index:8;color:#8fa3bd;font-size:9px;pointer-events:none}
</style>
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@5.0.8/dist/lightweight-charts.standalone.production.js"></script>
</head><body><div id="root"><div id="hud">Arcus Pro Chart · waiting for market data</div>
<div id="mainWrap"><div id="main"></div><div id="overlay"><div id="legend"></div><canvas id="drawCanvas"></canvas><div id="alertLayer"></div><button id="crossPlus">+</button><div id="status"></div></div></div><div id="rsi"></div></div>
<script>
(function(){
const hud=document.getElementById('hud'),mainEl=document.getElementById('main'),wrap=document.getElementById('mainWrap'),rsiEl=document.getElementById('rsi');
if(!window.LightweightCharts){document.getElementById('status').textContent='Chart library could not load. Check internet connection.';return;}
const L=window.LightweightCharts;
const chart=L.createChart(mainEl,{width:mainEl.clientWidth,height:mainEl.clientHeight,layout:{background:{type:'solid',color:'#090f1b'},textColor:'#9aabc3',fontSize:10},grid:{vertLines:{color:'#18263a'},horzLines:{color:'#18263a'}},rightPriceScale:{borderColor:'#26364e',scaleMargins:{top:.08,bottom:.12}},timeScale:{borderColor:'#26364e',timeVisible:true,secondsVisible:false},crosshair:{mode:L.CrosshairMode.Normal,vertLine:{color:'#eabf58',style:2},horzLine:{color:'#eabf58',style:2}},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{axisPressedMouseMove:{time:true,price:true},mouseWheel:true,pinch:true}});
let candle=chart.addSeries(L.CandlestickSeries,{upColor:'#34d399',downColor:'#f87171',borderUpColor:'#34d399',borderDownColor:'#f87171',wickUpColor:'#34d399',wickDownColor:'#f87171',priceLineVisible:true});
const volume=chart.addSeries(L.HistogramSeries,{priceScaleId:'',priceFormat:{type:'volume'},lastValueVisible:false,priceLineVisible:false});
chart.priceScale('').applyOptions({scaleMargins:{top:.82,bottom:0}});
let rsiChart=null,rsiSeries=null,raw=[],alerts=[],priceLines=[],indicators={},chartType='candles',symbol='',drawTool='',drawings=[],draft=null,dragAlert=-1;
const canvas=document.getElementById('drawCanvas'),ctx=canvas.getContext('2d'),alertLayer=document.getElementById('alertLayer'),plus=document.getElementById('crossPlus');
function resize(){chart.applyOptions({width:mainEl.clientWidth,height:mainEl.clientHeight});canvas.width=Math.max(1,wrap.clientWidth*devicePixelRatio);canvas.height=Math.max(1,wrap.clientHeight*devicePixelRatio);canvas.style.width=wrap.clientWidth+'px';canvas.style.height=wrap.clientHeight+'px';ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);redrawDrawings();if(rsiChart)rsiChart.applyOptions({width:rsiEl.clientWidth,height:rsiEl.clientHeight});}
new ResizeObserver(resize).observe(wrap);
function computeMA(n,ema){let out=[],v=null,k=2/(n+1);for(let i=0;i<raw.length;i++){let c=raw[i].close;if(ema)v=v===null?c:c*k+v*(1-k);else{let s=0;for(let j=Math.max(0,i-n+1);j<=i;j++)s+=raw[j].close;v=s/Math.min(i+1,n);}if(i>=n-1||ema)out.push({time:raw[i].time,value:v});}return out;}
function computeBB(n=20,m=2){let u=[],l=[],mid=[];for(let i=n-1;i<raw.length;i++){let vals=raw.slice(i-n+1,i+1).map(x=>x.close),avg=vals.reduce((a,b)=>a+b,0)/n,sd=Math.sqrt(vals.reduce((a,b)=>a+(b-avg)*(b-avg),0)/n);mid.push({time:raw[i].time,value:avg});u.push({time:raw[i].time,value:avg+m*sd});l.push({time:raw[i].time,value:avg-m*sd});}return{u,l,mid};}
function computeRSI(n=14){let out=[],gain=0,loss=0;for(let i=1;i<raw.length;i++){let d=raw[i].close-raw[i-1].close;gain+=Math.max(0,d);loss+=Math.max(0,-d);if(i>=n){let rs=(gain/n)/(loss/n||1e-10);out.push({time:raw[i].time,value:100-100/(1+rs)});let old=raw[i-n+1].close-raw[i-n].close;gain-=Math.max(0,old);loss-=Math.max(0,-old);}}return out;}
function clearIndicator(key){(indicators[key]||[]).forEach(s=>{try{chart.removeSeries(s);}catch(e){}});delete indicators[key];}
function setIndicator(key,on){clearIndicator(key);if(!on||!raw.length)return;let add=(data,color,width)=>{let s=chart.addSeries(L.LineSeries,{color,lineWidth:width||1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});s.setData(data);(indicators[key]||(indicators[key]=[])).push(s);};
if(key==='sma')add(computeMA(20,false),'#fbbf24',2);
if(key==='ema')add(computeMA(20,true),'#60a5fa',2);
if(key==='bb'){let b=computeBB();add(b.u,'#a78bfa',1);add(b.l,'#a78bfa',1);add(b.mid,'#7c6bb0',1);}
if(key==='rsi'){rsiEl.style.height= '88px';if(!rsiChart){rsiChart=L.createChart(rsiEl,{width:rsiEl.clientWidth,height:88,layout:{background:{type:'solid',color:'#090f1b'},textColor:'#8294ad',fontSize:9},grid:{vertLines:{visible:false},horzLines:{color:'#1a2a3d'}},rightPriceScale:{borderColor:'#26364e'},timeScale:{visible:false},handleScroll:false,handleScale:false});}if(rsiSeries){rsiChart.removeSeries(rsiSeries);}rsiSeries=rsiChart.addSeries(L.LineSeries,{color:'#c084fc',lineWidth:2,priceLineVisible:false});rsiSeries.setData(computeRSI());rsiSeries.createPriceLine({price:70,color:'#7b4652',lineStyle:2,lineWidth:1,axisLabelVisible:false});rsiSeries.createPriceLine({price:30,color:'#356b5b',lineStyle:2,lineWidth:1,axisLabelVisible:false});resize();}
if(key==='volume'){volume.applyOptions({visible:true});}else if(key==='volumeOff'){volume.applyOptions({visible:false});}
}
function setCandles(data){raw=Array.isArray(data)?data:[];if(chartType==='line')candle.setData(raw.map(x=>({time:x.time,value:x.close})));else candle.setData(raw);volume.setData(raw.map(x=>({time:x.time,value:Math.max(0,(x.volume||0)),color:x.close>=x.open?'#34d39966':'#f8717166'})));chart.timeScale().fitContent();Object.keys(indicators).forEach(k=>{let was=true;setIndicator(k,was);});if(rsiSeries)setIndicator('rsi',true);hud.textContent=raw.length?('O '+fmt(raw[raw.length-1].open)+'  H '+fmt(raw[raw.length-1].high)+'  L '+fmt(raw[raw.length-1].low)+'  C '+fmt(raw[raw.length-1].close)):'No candles';redrawAlerts();redrawDrawings();}
function fmt(v){return Number(v).toPrecision(7);}
function setAlerts(values){alerts=Array.isArray(values)?values:[];redrawAlerts();}
function redrawAlerts(){alertLayer.innerHTML='';alerts.forEach((price,i)=>{let y=candle.priceToCoordinate(price);if(y===null)return;let line=document.createElement('div');line.className='alertLine';line.style.top=y+'px';line.dataset.index=i;let tag=document.createElement('span');tag.className='alertTag';tag.textContent=fmt(price);line.appendChild(tag);line.addEventListener('pointerdown',e=>{dragAlert=i;line.setPointerCapture(e.pointerId);e.preventDefault();});line.addEventListener('pointermove',e=>{if(dragAlert!==i)return;let rect=wrap.getBoundingClientRect(),p=candle.coordinateToPrice(e.clientY-rect.top);if(p!==null){line.style.top=(e.clientY-rect.top)+'px';tag.textContent=fmt(p);line.dataset.price=p;}});line.addEventListener('pointerup',e=>{if(dragAlert===i){let p=Number(line.dataset.price);if(p>0&&window.ArcusNative)ArcusNative.onAlertMoved(i,p);dragAlert=-1;}});line.addEventListener('click',()=>{if(window.ArcusNative)ArcusNative.onAlertSelected(i);});alertLayer.appendChild(line);});}
function setSymbol(s){symbol=s||'';try{drawings=JSON.parse(localStorage.getItem('arcus-draw-'+symbol)||'[]');}catch(e){drawings=[];}redrawDrawings();}
function setChartType(type){chartType=type;if(type==='line'){let data=raw.map(x=>({time:x.time,value:x.close}));chart.removeSeries(candle);candle=chart.addSeries(L.LineSeries,{color:'#48c6a7',lineWidth:2,priceLineVisible:true});candle.setData(data);}else if(type==='bars'){let data=raw;chart.removeSeries(candle);candle=chart.addSeries(L.BarSeries,{upColor:'#34d399',downColor:'#f87171',openVisible:true,thinBars:false});candle.setData(data);}else{chart.removeSeries(candle);candle=chart.addSeries(L.CandlestickSeries,{upColor:'#34d399',downColor:'#f87171',borderUpColor:'#34d399',borderDownColor:'#f87171',wickUpColor:'#34d399',wickDownColor:'#f87171'});candle.setData(raw);}redrawAlerts();redrawDrawings();}
function clearDrawings(){drawings=[];draft=null;saveDrawings();redrawDrawings();drawTool='';canvas.style.pointerEvents='none';chart.applyOptions({handleScroll:true,handleScale:true});document.getElementById('status').textContent='';}\nfunction setDrawingTool(t){drawTool=t||'';canvas.style.pointerEvents=drawTool?'auto':'none';chart.applyOptions({handleScroll:!drawTool,handleScale:!drawTool});document.getElementById('status').textContent=drawTool?'Drawing: '+drawTool+' · tap/drag on chart':'';
}
function pointAt(e){let r=wrap.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;return{time:chart.timeScale().coordinateToTime(x),price:candle.coordinateToPrice(y),x,y};}
function saveDrawings(){try{localStorage.setItem('arcus-draw-'+symbol,JSON.stringify(drawings));}catch(e){}}
function redrawDrawings(){if(!ctx||!canvas.width)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.scale(devicePixelRatio,devicePixelRatio);drawings.forEach(d=>paintDrawing(d));if(draft)paintDrawing(draft);ctx.restore();}
function paintDrawing(d){if(!d||!d.t1)return;let x1=chart.timeScale().timeToCoordinate(d.t1),y1=candle.priceToCoordinate(d.p1);if(x1===null||y1===null)return;let x2=d.t2?chart.timeScale().timeToCoordinate(d.t2):wrap.clientWidth,y2=d.p2===undefined?y1:candle.priceToCoordinate(d.p2);if(x2===null)x2=wrap.clientWidth;if(y2===null)y2=y1;ctx.strokeStyle='#f6c65b';ctx.fillStyle='#f6c65b22';ctx.lineWidth=1.5;ctx.beginPath();if(d.type==='hline'||d.type==='ray'){ctx.moveTo(d.type==='ray'?x1:0,y1);ctx.lineTo(wrap.clientWidth,y1);}else if(d.type==='rectangle'){ctx.rect(x1,y1,x2-x1,y2-y1);ctx.fill();}else if(d.type==='fib'){let levels=[0,.236,.382,.5,.618,.786,1];levels.forEach(v=>{let y=y1+(y2-y1)*v;ctx.moveTo(x1,y);ctx.lineTo(x2,y);});}else{ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);}ctx.stroke();}
canvas.addEventListener('pointerdown',e=>{if(!drawTool)return;let p=pointAt(e);if(p.time===null||p.price===null)return;draft={type:drawTool,t1:p.time,p1:p.price,t2:p.time,p2:p.price};canvas.setPointerCapture(e.pointerId);redrawDrawings();});
canvas.addEventListener('pointermove',e=>{if(!draft)return;let p=pointAt(e);if(p.time!==null&&p.price!==null){draft.t2=p.time;draft.p2=p.price;redrawDrawings();}});
canvas.addEventListener('pointerup',()=>{if(draft){drawings.push(draft);draft=null;saveDrawings();redrawDrawings();}});
chart.subscribeCrosshairMove(param=>{if(!param||!param.point){plus.style.display='none';return;}let d=param.seriesData.get(candle);if(d&&d.open!==undefined)hud.textContent='O '+fmt(d.open)+'  H '+fmt(d.high)+'  L '+fmt(d.low)+'  C '+fmt(d.close);let p=candle.coordinateToPrice(param.point.y);if(p!==null){plus.style.display='block';plus.style.top=Math.max(2,Math.min(wrap.clientHeight-27,param.point.y-12))+'px';plus.onclick=()=>{if(window.ArcusNative)ArcusNative.onPriceTap(p);};}});
chart.subscribeClick(param=>{if(drawTool||!param||!param.point)return;let p=candle.coordinateToPrice(param.point.y);if(p!==null){plus.style.display='block';plus.style.top=Math.max(2,Math.min(wrap.clientHeight-27,param.point.y-12))+'px';}});
let touchStart=null;wrap.addEventListener('touchstart',e=>{if(!e.touches.length)return;let x=e.touches[0].clientX,r=wrap.getBoundingClientRect();if(x-r.left<24||r.right-x<24)touchStart={x};},{passive:true});wrap.addEventListener('touchend',e=>{if(!touchStart||!e.changedTouches.length)return;let dx=e.changedTouches[0].clientX-touchStart.x;if(Math.abs(dx)>85&&window.ArcusNative)ArcusNative.onChartSwipe(dx<0?1:-1);touchStart=null;},{passive:true});
chart.timeScale().subscribeVisibleTimeRangeChange(redrawDrawings);
window.ArcusChart={setCandles,setAlerts,setSymbol,setIndicator,setChartType,setDrawingTool,clearDrawings,fitContent:()=>chart.timeScale().fitContent(),zoomTime:f=>{let r=chart.timeScale().getVisibleLogicalRange();if(r){let mid=(r.from+r.to)/2,span=(r.to-r.from)*f;chart.timeScale().setVisibleLogicalRange({from:mid-span/2,to:mid+span/2});}},zoomPrice:f=>{let s=chart.priceScale('right');s.applyOptions({autoScale:true});},};
resize();
})();
</script></body></html>
""";
}
