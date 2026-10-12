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
                item.put("close", candle.close);
                item.put("volume", candle.volume);
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

    public void setTriggeredAlertPrice(double price) { runChartJs("focusAlert(" + price + ");"); }

    public void setSymbol(String symbol) {
        currentSymbol = symbol == null ? "" : symbol;
        runChartJs("setSymbol(" + JSONObject.quote(currentSymbol) + ");");
    }

    public void setChartType(String type) {
        runChartJs("setChartType(" + JSONObject.quote(type) + ");");
    }

    public void setDrawingTool(String tool) {
        runChartJs("setDrawingTool(" + JSONObject.quote(tool) + ");");
    }
    public void clearDrawings() { runChartJs("clearDrawings();"); }

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
#hud{height:27px;flex:none;padding:5px 8px;font-size:10px;color:#9aabc3;white-space:nowrap;overflow:hidden}#symbolTag{position:absolute;top:5px;right:9px;z-index:10;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;font-weight:600;letter-spacing:.25px;color:#8293aa;opacity:.72;pointer-events:none}
#mainWrap{position:relative;flex:1;min-height:150px;touch-action:none}
#main{position:absolute;inset:0}

#overlay{position:absolute;inset:0;pointer-events:none;z-index:5}
#drawCanvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
#alertLayer{position:absolute;inset:0;pointer-events:none}
.alertLine{position:absolute;left:0;right:0;height:40px;transform:translateY(-20px);pointer-events:auto;touch-action:none;cursor:ns-resize}
.alertLine:before{content:'';position:absolute;left:0;right:0;top:19px;border-top:1px dashed #4aaaff}
.alertTag{position:absolute;right:2px;top:1px;background:#245b87;color:#fff;border-radius:4px;padding:3px 5px;font-size:9px}.newAlertLine{position:absolute;left:0;right:0;height:30px;transform:translateY(-15px);pointer-events:none;z-index:9}.newAlertLine:before{content:'';position:absolute;left:0;right:0;top:14px;border-top:1px solid #f6c65b}.newAlertTag{position:absolute;right:34px;top:2px;background:#8a6822;color:#fff;border-radius:4px;padding:4px 6px;font-size:9px;font-weight:bold}.pricePickPlus{position:absolute;right:3px;top:0;width:28px;height:28px;border:0;border-radius:6px;background:#f6c65b;color:#17202d;font-size:22px;font-weight:bold;line-height:26px;padding:0;pointer-events:auto;touch-action:manipulation}
#crossPlus{display:none!important;position:absolute;right:4px;width:25px;height:25px;border:0;border-radius:50%;background:#34d399;color:#071b17;font-size:20px;font-weight:bold;z-index:8;padding:0}
#legend{position:absolute;left:5px;top:4px;z-index:6;font-size:9px;color:#d6e2f2;background:#0d1726cc;padding:4px 6px;border-radius:4px;pointer-events:none}
#status{position:absolute;left:8px;bottom:4px;z-index:8;color:#8fa3bd;font-size:9px;pointer-events:none}
</style>
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@5.0.8/dist/lightweight-charts.standalone.production.js"></script>
</head><body><div id="root"><div id="hud">Arcus Pro Chart · waiting for market data</div><div id="symbolTag"></div>
<div id="mainWrap"><div id="main"></div><div id="overlay"><div id="legend"></div><canvas id="drawCanvas"></canvas><div id="alertLayer"></div><button id="crossPlus">+</button><div id="status"></div></div></div></div>
<script>
(function(){
const hud=document.getElementById('hud'),mainEl=document.getElementById('main'),wrap=document.getElementById('mainWrap');
if(!window.LightweightCharts){document.getElementById('status').textContent='Chart library could not load. Check internet connection.';return;}
const L=window.LightweightCharts;
const chart=L.createChart(mainEl,{width:mainEl.clientWidth,height:mainEl.clientHeight,layout:{background:{type:'solid',color:'#090f1b'},textColor:'#9aabc3',fontSize:10},attributionLogo:false,grid:{vertLines:{color:'#18263a'},horzLines:{color:'#18263a'}},rightPriceScale:{borderColor:'#26364e',scaleMargins:{top:.08,bottom:.12}},timeScale:{borderColor:'#26364e',timeVisible:true,secondsVisible:false,rightOffset:30},crosshair:{mode:L.CrosshairMode.Normal,vertLine:{color:'#eabf58',style:2},horzLine:{color:'#eabf58',style:2}},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:{axisPressedMouseMove:{time:true,price:true},mouseWheel:true,pinch:true}});
let candle=chart.addSeries(L.CandlestickSeries,{upColor:'#34d399',downColor:'#f87171',borderUpColor:'#34d399',borderDownColor:'#f87171',wickUpColor:'#34d399',wickDownColor:'#f87171',priceLineVisible:true});
let raw=[],alerts=[],priceLines=[],chartType='candles',symbol='',drawTool='',drawings=[],draft=null,dragAlert=-1,pickedPrice=0,pickerLine=null,pressTimer=null,pressOrigin=null,pickerActive=false,pickerPointer=-1;
const canvas=document.getElementById('drawCanvas'),ctx=canvas.getContext('2d'),alertLayer=document.getElementById('alertLayer'),plus=document.getElementById('crossPlus');
function resize(){chart.applyOptions({width:mainEl.clientWidth,height:mainEl.clientHeight});canvas.width=Math.max(1,wrap.clientWidth*devicePixelRatio);canvas.height=Math.max(1,wrap.clientHeight*devicePixelRatio);canvas.style.width=wrap.clientWidth+'px';canvas.style.height=wrap.clientHeight+'px';ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);redrawDrawings();}
new ResizeObserver(resize).observe(wrap);
function setCandles(data){raw=Array.isArray(data)?data:[];if(chartType==='line')candle.setData(raw.map(x=>({time:x.time,value:x.close})));else candle.setData(raw);chart.timeScale().fitContent();hud.textContent=raw.length?('O '+fmt(raw[raw.length-1].open)+'  H '+fmt(raw[raw.length-1].high)+'  L '+fmt(raw[raw.length-1].low)+'  C '+fmt(raw[raw.length-1].close)):'No candles';redrawAlerts();redrawDrawings();}
function fmt(v){return Number(v).toPrecision(7);}
function setAlerts(values){alerts=Array.isArray(values)?values:[];redrawAlerts();}
function redrawAlerts(){alertLayer.querySelectorAll('.alertLine').forEach(line=>line.remove());alerts.forEach((price,i)=>{let y=candle.priceToCoordinate(price);if(y===null)return;let line=document.createElement('div');line.className='alertLine';line.style.top=y+'px';line.dataset.index=i;let tag=document.createElement('span');tag.className='alertTag';tag.textContent=fmt(price);line.appendChild(tag);let startY=0,moved=false;line.addEventListener('pointerdown',e=>{dragAlert=i;startY=e.clientY;moved=false;line.dataset.price=String(price);try{line.setPointerCapture(e.pointerId);}catch(ignore){}e.preventDefault();});line.addEventListener('pointermove',e=>{if(dragAlert!==i)return;let rect=wrap.getBoundingClientRect(),localY=Math.max(0,Math.min(wrap.clientHeight,e.clientY-rect.top)),p=candle.coordinateToPrice(localY);if(Math.abs(e.clientY-startY)>4)moved=true;if(p!==null){line.style.top=localY+'px';tag.textContent=fmt(p);line.dataset.price=String(p);}});line.addEventListener('pointerup',e=>{if(dragAlert!==i)return;let p=Number(line.dataset.price);if(moved&&p>0&&window.ArcusNative)ArcusNative.onAlertMoved(i,p);else if(!moved&&window.ArcusNative)ArcusNative.onAlertSelected(i);dragAlert=-1;});line.addEventListener('pointercancel',()=>{if(dragAlert===i)dragAlert=-1;});alertLayer.appendChild(line);});if(pickerLine&&pickedPrice>0){let pickerY=candle.priceToCoordinate(pickedPrice);if(pickerY!==null)pickerLine.style.top=pickerY+'px';}}
function clearPricePicker(){if(pickerLine){pickerLine.remove();pickerLine=null;}pickedPrice=0;}
function showPricePicker(y){let p=candle.coordinateToPrice(y);if(p===null||!isFinite(p))return;clearPricePicker();pickedPrice=p;pickerLine=document.createElement('div');pickerLine.className='newAlertLine';pickerLine.style.top=y+'px';let tag=document.createElement('span');tag.className='newAlertTag';tag.textContent=fmt(p);let add=document.createElement('button');add.className='pricePickPlus';add.type='button';add.textContent='+';add.addEventListener('pointerdown',e=>e.stopPropagation());add.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();let chosen=pickedPrice;if(chosen>0&&window.ArcusNative)ArcusNative.onPriceTap(chosen);clearPricePicker();});pickerLine.appendChild(tag);pickerLine.appendChild(add);alertLayer.appendChild(pickerLine);}
function movePricePicker(y){if(!pickerLine)return;let yy=Math.max(0,Math.min(wrap.clientHeight,y)),p=candle.coordinateToPrice(yy);if(p===null||!isFinite(p))return;pickedPrice=p;pickerLine.style.top=yy+'px';let tag=pickerLine.querySelector('.newAlertTag');if(tag)tag.textContent=fmt(p);}
function setSymbol(s){symbol=s||'';document.getElementById('symbolTag').textContent=symbol;try{drawings=JSON.parse(localStorage.getItem('arcus-draw-'+symbol)||'[]');}catch(e){drawings=[];}redrawDrawings();}
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
chart.subscribeCrosshairMove(param=>{if(!param||!param.point)return;let d=param.seriesData.get(candle);if(d&&d.open!==undefined)hud.textContent='O '+fmt(d.open)+'  H '+fmt(d.high)+'  L '+fmt(d.low)+'  C '+fmt(d.close);});
wrap.addEventListener('pointerdown',e=>{if(drawTool||e.target.closest('.alertLine')||e.target.closest('.pricePickPlus'))return;clearTimeout(pressTimer);pressOrigin={x:e.clientX,y:e.clientY};pickerActive=false;pickerPointer=e.pointerId;let rect=wrap.getBoundingClientRect();let y=e.clientY-rect.top;pressTimer=setTimeout(()=>{if(!pressOrigin||pickerPointer!==e.pointerId)return;pickerActive=true;chart.applyOptions({handleScroll:false,handleScale:false});try{wrap.setPointerCapture(e.pointerId);}catch(ignore){}showPricePicker(y);},450);});
wrap.addEventListener('pointermove',e=>{if(!pressOrigin||pickerPointer!==e.pointerId)return;let dx=e.clientX-pressOrigin.x,dy=e.clientY-pressOrigin.y;if(!pickerActive){if(Math.hypot(dx,dy)>9){clearTimeout(pressTimer);pressTimer=null;pressOrigin=null;pickerPointer=-1;}return;}let rect=wrap.getBoundingClientRect();movePricePicker(e.clientY-rect.top);});
const finishPriceHold=e=>{if(pickerPointer!==e.pointerId)return;clearTimeout(pressTimer);pressTimer=null;if(pickerActive){chart.applyOptions({handleScroll:true,handleScale:true});}pressOrigin=null;pickerPointer=-1;pickerActive=false;};
wrap.addEventListener('pointerup',finishPriceHold);wrap.addEventListener('pointercancel',finishPriceHold);

// Native Lightweight Charts touch gestures provide direct chart dragging and pinch zoom.
chart.timeScale().subscribeVisibleTimeRangeChange(()=>{redrawDrawings();redrawAlerts();});
window.ArcusChart={setCandles,setAlerts,setSymbol,setChartType,setDrawingTool,clearDrawings,focusAlert:(price)=>{let y=candle.priceToCoordinate(price);if(y!==null){let line=document.createElement('div');line.className='alertLine';line.style.top=y+'px';line.style.pointerEvents='none';line.style.zIndex='12';line.style.height='3px';line.style.borderTop='2px solid #f6c65b';let tag=document.createElement('span');tag.className='alertTag';tag.style.background='#8a6822';tag.textContent='TRIGGERED '+fmt(price);line.appendChild(tag);alertLayer.appendChild(line);setTimeout(()=>line.remove(),8000);}chart.timeScale().scrollToRealTime();},fitContent:()=>{chart.priceScale('right').applyOptions({autoScale:true});chart.timeScale().fitContent();},zoomTime:f=>{let r=chart.timeScale().getVisibleLogicalRange();if(r){let mid=(r.from+r.to)/2,span=(r.to-r.from)*f;chart.timeScale().setVisibleLogicalRange({from:mid-span/2,to:mid+span/2});}},zoomPrice:f=>{let s=chart.priceScale('right');s.applyOptions({autoScale:true});},};
resize();
})();
</script></body></html>
""";
}
