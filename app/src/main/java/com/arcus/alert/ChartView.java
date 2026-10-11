package com.arcus.alert;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Color;
import android.view.View;
import android.view.MotionEvent;
import java.util.ArrayList;
import java.util.List;
public class ChartView extends View {
 public static class Candle { public final long time; public final double open,high,low,close; public Candle(long t,double o,double h,double l,double c){time=t;open=o;high=h;low=l;close=c;} }
 public interface OnPriceTapListener { void onPriceTap(double price); }
 private final Paint paint=new Paint(3); private final ArrayList<Candle> candles=new ArrayList<>(); private OnPriceTapListener listener; private double min=0,max=0;
 public ChartView(Context c){super(c);}
 public void setOnPriceTapListener(OnPriceTapListener l){listener=l;}
 public void setCandles(List<Candle> data){candles.clear();if(data!=null)candles.addAll(data);min=Double.MAX_VALUE;max=-Double.MAX_VALUE;for(Candle c:candles){min=Math.min(min,c.low);max=Math.max(max,c.high);}if(min==max){min*=0.999;max*=1.001;}invalidate();}
 @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);float w=getWidth(),h=getHeight();canvas.drawColor(Color.rgb(9,15,27));paint.setColor(Color.rgb(38,54,78));paint.setStrokeWidth(1);for(int i=1;i<5;i++){float y=h*i/5f;canvas.drawLine(0,y,w,y,paint);}if(candles.isEmpty()){paint.setColor(Color.LTGRAY);paint.setTextSize(14);canvas.drawText("No chart data loaded",18,h/2,paint);return;}double range=max-min;if(range<=0)return;float pad=18,usableH=h-2*pad,step=(w-2*pad)/(float)candles.size(),body=Math.max(2,step*0.62f);for(int i=0;i<candles.size();i++){Candle c=candles.get(i);float x=pad+i*step+step/2;float yH=pad+(float)((max-c.high)/range)*usableH,yL=pad+(float)((max-c.low)/range)*usableH,yO=pad+(float)((max-c.open)/range)*usableH,yC=pad+(float)((max-c.close)/range)*usableH;int col=c.close>=c.open?Color.rgb(52,211,153):Color.rgb(248,113,113);paint.setColor(col);paint.setStrokeWidth(1.5f);canvas.drawLine(x,yH,x,yL,paint);paint.setStyle(Paint.Style.FILL);canvas.drawRect(x-body/2,Math.min(yO,yC),x+body/2,Math.max(yO,yC)+1,paint);}paint.setColor(Color.rgb(151,166,190));paint.setTextSize(10);canvas.drawText(String.format(java.util.Locale.US,"%.5f",max),6,13,paint);canvas.drawText(String.format(java.util.Locale.US,"%.5f",min),6,h-5,paint);}
 @Override public boolean onTouchEvent(MotionEvent e){if(e.getAction()==MotionEvent.ACTION_UP){if(listener!=null&&!candles.isEmpty()){float y=Math.max(18,Math.min(getHeight()-18,e.getY()));double price=max-((y-18)/(getHeight()-36))*(max-min);listener.onPriceTap(price);}performClick();return true;}return true;}
 @Override public boolean performClick(){super.performClick();return true;}
}