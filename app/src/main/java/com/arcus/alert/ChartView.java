package com.arcus.alert;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Color;
import android.graphics.PathEffect;
import android.graphics.DashPathEffect;
import android.view.View;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class ChartView extends View {
 public static class Candle {
  public final long time; public final double open,high,low,close;
  public Candle(long t,double o,double h,double l,double c){time=t;open=o;high=h;low=l;close=c;}
 }
 public interface OnPriceTapListener { void onPriceTap(double price); }
 private final Paint p=new Paint(3);
 private final ArrayList<Candle> candles=new ArrayList<>();
 private OnPriceTapListener listener;
 private double min=0,max=0,selectedPrice=0;
 private float crossY=-1,lastX,lastY;
 private int visibleCount=90,startIndex=0;
 private boolean plusDown=false;
 private final ScaleGestureDetector scaleDetector;
 private static final int RIGHT_GUTTER=58;
 public ChartView(Context c){super(c);setLayerType(View.LAYER_TYPE_SOFTWARE,null);scaleDetector=new ScaleGestureDetector(c,new ScaleGestureDetector.SimpleOnScaleGestureListener(){
  @Override public boolean onScale(ScaleGestureDetector d){int old=visibleCount;visibleCount=Math.max(12,Math.min(240,(int)(visibleCount/d.getScaleFactor())));if(old!=visibleCount){startIndex=Math.max(0,Math.min(Math.max(0,candles.size()-visibleCount),startIndex));invalidate();}return true;}
 });}
 public void setOnPriceTapListener(OnPriceTapListener l){listener=l;}
 public void setCandles(List<Candle> data){candles.clear();if(data!=null)candles.addAll(data);startIndex=Math.max(0,candles.size()-visibleCount);crossY=-1;recalcRange();invalidate();}
 private void recalcRange(){min=Double.MAX_VALUE;max=-Double.MAX_VALUE;int end=Math.min(candles.size(),startIndex+visibleCount);for(int i=startIndex;i<end;i++){Candle c=candles.get(i);min=Math.min(min,c.low);max=Math.max(max,c.high);}if(min==Double.MAX_VALUE){min=0;max=1;}if(min==max){double v=Math.max(Math.abs(min)*0.001,0.000001);min-=v;max+=v;}}
 private double priceAt(float y){float top=18,bottom=getHeight()-18;return max-((Math.max(top,Math.min(bottom,y))-top)/(bottom-top))*(max-min);}
 @Override protected void onDraw(Canvas c){
  super.onDraw(c);float w=getWidth(),h=getHeight();c.drawColor(Color.rgb(9,15,27));
  p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(1);p.setColor(Color.rgb(34,48,69));for(int i=1;i<5;i++){float y=h*i/5f;c.drawLine(0,y,w-RIGHT_GUTTER,y,p);}
  if(candles.isEmpty()){p.setStyle(Paint.Style.FILL);p.setColor(Color.LTGRAY);p.setTextSize(14);c.drawText("No chart data loaded",18,h/2,p);return;}
  recalcRange();int end=Math.min(candles.size(),startIndex+visibleCount);int count=end-startIndex;
  float left=8,plotW=Math.max(1,w-RIGHT_GUTTER-left),pad=18,usableH=h-2*pad,step=plotW/Math.max(1,count),body=Math.max(1.5f,step*0.64f);double range=max-min;
  p.setStyle(Paint.Style.FILL);
  for(int j=0;j<count;j++){Candle x=candles.get(startIndex+j);float xx=left+j*step+step/2;
   float yh=pad+(float)((max-x.high)/range)*usableH,yl=pad+(float)((max-x.low)/range)*usableH,yo=pad+(float)((max-x.open)/range)*usableH,yc=pad+(float)((max-x.close)/range)*usableH;
   p.setColor(x.close>=x.open?Color.rgb(52,211,153):Color.rgb(248,113,113));p.setStrokeWidth(1.4f);c.drawLine(xx,yh,xx,yl,p);c.drawRect(xx-body/2,Math.min(yo,yc),xx+body/2,Math.max(yo,yc)+1,p);
  }
  p.setColor(Color.rgb(151,166,190));p.setTextSize(10);p.setStyle(Paint.Style.FILL);c.drawText(String.format(Locale.US,"%.5f",max),5,13,p);c.drawText(String.format(Locale.US,"%.5f",min),5,h-5,p);
  if(crossY>=0){
   p.setColor(Color.rgb(244,190,80));p.setStrokeWidth(1.2f);p.setStyle(Paint.Style.STROKE);p.setPathEffect(new DashPathEffect(new float[]{8,6},0));c.drawLine(0,crossY,w-RIGHT_GUTTER,crossY,p);p.setPathEffect(null);p.setStyle(Paint.Style.FILL);
   String value=String.format(Locale.US,"%.6f",selectedPrice);float tagW=Math.min(RIGHT_GUTTER-4,p.measureText(value)+8);p.setColor(Color.rgb(244,190,80));c.drawRoundRect(w-RIGHT_GUTTER+2,crossY-10,w-2,crossY+10,5,5,p);p.setColor(Color.rgb(12,18,30));p.setTextSize(9);c.drawText(value,w-RIGHT_GUTTER+5,crossY+3,p);
   float cx=w-28,cy=crossY;p.setColor(Color.rgb(52,211,153));c.drawCircle(cx,cy,14,p);p.setColor(Color.rgb(5,20,25));p.setTextSize(21);p.setFakeBoldText(true);c.drawText("+",cx-6,cy+7,p);p.setFakeBoldText(false);
  }
 }
 @Override public boolean onTouchEvent(MotionEvent e){
  scaleDetector.onTouchEvent(e);
  switch(e.getActionMasked()){
   case MotionEvent.ACTION_DOWN:lastX=e.getX();lastY=e.getY();plusDown=(crossY>=0&&e.getX()>getWidth()-RIGHT_GUTTER&&Math.abs(e.getY()-crossY)<26);if(crossY<0){crossY=e.getY();selectedPrice=priceAt(crossY);}invalidate();return true;
   case MotionEvent.ACTION_POINTER_DOWN:plusDown=false;return true;
   case MotionEvent.ACTION_MOVE:
    if(e.getPointerCount()==1&&!scaleDetector.isInProgress()){
     float dx=e.getX()-lastX;
     if(Math.abs(dx)>1){float step=(getWidth()-RIGHT_GUTTER-8)/(float)Math.max(1,visibleCount);int shift=Math.round(-dx/Math.max(1,step));if(shift!=0){startIndex=Math.max(0,Math.min(Math.max(0,candles.size()-visibleCount),startIndex+shift));recalcRange();}}
     crossY=Math.max(18,Math.min(getHeight()-18,e.getY()));selectedPrice=priceAt(crossY);lastX=e.getX();lastY=e.getY();plusDown=false;invalidate();
    }return true;
   case MotionEvent.ACTION_UP:
    if(plusDown&&listener!=null&&crossY>=0&&e.getX()>getWidth()-RIGHT_GUTTER&&Math.abs(e.getY()-crossY)<30){listener.onPriceTap(selectedPrice);}
    plusDown=false;performClick();return true;
   case MotionEvent.ACTION_CANCEL:plusDown=false;return true;
  }return true;
 }
 @Override public boolean performClick(){super.performClick();return true;}
}