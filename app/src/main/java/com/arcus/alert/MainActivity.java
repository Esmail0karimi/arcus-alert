package com.arcus.alert;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.graphics.Color;
import android.view.View;
import android.view.Gravity;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {
    static final String PREF="arcus_native";
    LinearLayout root, list;
    EditText symbolInput, priceInput;
    Spinner modeSpinner;
    TextView status;
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.rgb(11,18,32));
        getWindow().setNavigationBarColor(Color.rgb(11,18,32));
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},10);
        buildUi();
        startMonitor();
    }
    int dp(float v){return (int)(v*getResources().getDisplayMetrics().density);}
    TextView text(String s,int size){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(Color.rgb(238,244,255));return t;}
    void buildUi(){
        ScrollView scroll=new ScrollView(this);scroll.setBackgroundColor(Color.rgb(11,18,32));
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(18),dp(22),dp(18),dp(28));scroll.addView(root);setContentView(scroll);
        TextView title=text("🔔 Arcus Alert",28);title.setGravity(Gravity.CENTER_VERTICAL);root.addView(title);
        TextView sub=text("Native Android price alerts",15);sub.setTextColor(Color.LTGRAY);root.addView(sub);
        status=text("Starting price monitor…",14);status.setPadding(0,dp(14),0,dp(14));root.addView(status);
        TextView label=text("Add price alert",20);label.setPadding(0,dp(12),0,dp(10));root.addView(label);
        symbolInput=new EditText(this);symbolInput.setSingleLine(true);symbolInput.setHint("Market symbol e.g. BTC-USD");symbolInput.setTextColor(Color.WHITE);symbolInput.setHintTextColor(Color.GRAY);root.addView(symbolInput,new LinearLayout.LayoutParams(-1,dp(52)));
        priceInput=new EditText(this);priceInput.setSingleLine(true);priceInput.setInputType(8194);priceInput.setHint("Target price");priceInput.setTextColor(Color.WHITE);priceInput.setHintTextColor(Color.GRAY);root.addView(priceInput,new LinearLayout.LayoutParams(-1,dp(52)));
        modeSpinner=new Spinner(this);String[] modes={"Crosses the level","Touches the level","Approaches within 0.1%"};modeSpinner.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,modes));root.addView(modeSpinner,new LinearLayout.LayoutParams(-1,dp(50)));
        Button add=new Button(this);add.setText("Add price alert");root.addView(add);add.setOnClickListener(v->addLevel());
        Button refresh=new Button(this);refresh.setText("Refresh / restart monitoring");root.addView(refresh);refresh.setOnClickListener(v->startMonitor());
        TextView saved=text("Saved alerts",20);saved.setPadding(0,dp(18),0,dp(8));root.addView(saved);
        list=new LinearLayout(this);list.setOrientation(LinearLayout.VERTICAL);root.addView(list);
        TextView note=text("Keep Arcus Alert running in the background. Android may require allowing background activity / unrestricted battery usage. Alerts are stored on this phone.",13);note.setTextColor(Color.LTGRAY);note.setPadding(0,dp(20),0,0);root.addView(note);
        renderLevels();
    }
    void startMonitor(){
        try {Intent i=new Intent(this,PriceMonitorService.class);if(Build.VERSION.SDK_INT>=26)startForegroundService(i);else startService(i);status.setText("Monitoring service started · Arcus prices checked in background");}
        catch(Exception e){status.setText("Could not start monitoring: "+e.getMessage());}
    }
    JSONArray levels(){String s=getSharedPreferences(PREF,0).getString("levels","[]");try{return new JSONArray(s);}catch(Exception e){return new JSONArray();}}
    void save(JSONArray a){getSharedPreferences(PREF,0).edit().putString("levels",a.toString()).apply();}
    void addLevel(){
        String sym=symbolInput.getText().toString().trim().toUpperCase();double p;
        try{p=Double.parseDouble(priceInput.getText().toString().trim());}catch(Exception e){p=0;}
        if(sym.isEmpty()||p<=0){new AlertDialog.Builder(this).setMessage("Enter a market symbol and a valid target price.").setPositiveButton("OK",null).show();return;}
        try{JSONArray a=levels();JSONObject o=new JSONObject();o.put("symbol",sym);o.put("price",p);o.put("mode",modeSpinner.getSelectedItemPosition());o.put("created",System.currentTimeMillis());a.put(o);save(a);symbolInput.setText("");priceInput.setText("");renderLevels();}
        catch(Exception ignored){}
    }
    void renderLevels(){
        if(list==null)return;list.removeAllViews();JSONArray a=levels();
        if(a.length()==0){TextView empty=text("No saved alerts yet.",14);empty.setTextColor(Color.LTGRAY);list.addView(empty);return;}
        for(int i=0;i<a.length();i++)try{
            final int idx=i;JSONObject o=a.getJSONObject(i);LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(0,dp(8),0,dp(8));
            TextView info=text(o.getString("symbol")+" · "+o.getDouble("price")+"\n"+new String[]{"Cross","Touch","Near"}[Math.max(0,Math.min(2,o.optInt("mode")))],15);row.addView(info,new LinearLayout.LayoutParams(0,-2,1));
            Button del=new Button(this);del.setText("Remove");row.addView(del);del.setOnClickListener(v->{try{JSONArray old=levels(),next=new JSONArray();for(int j=0;j<old.length();j++)if(j!=idx)next.put(old.get(j));save(next);renderLevels();}catch(Exception ignored){}});list.addView(row);
            View line=new View(this);line.setBackgroundColor(Color.rgb(38,52,75));list.addView(line,new LinearLayout.LayoutParams(-1,dp(1)));
        }catch(Exception ignored){}
    }
}
