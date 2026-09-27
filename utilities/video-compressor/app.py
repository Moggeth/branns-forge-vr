"""Small native drag-and-drop video compressor. All encoding remains local."""
import argparse, json, logging, os, pathlib, queue, sys, threading, traceback
from compressor import Compressor, Cancelled, EXTENSIONS, LOGS, LOG_FILE

def gui(paths):
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
    from tkinterdnd2 import TkinterDnD, DND_FILES
    root = TkinterDnD.Tk()
    root.title('Pocket Video · Share smaller')
    root.geometry('820x700'); root.minsize(740, 660)
    bg, panel, fg, muted, accent = '#14272c', '#203940', '#fff1d5', '#b4c8c8', '#efbe72'
    root.configure(bg=bg)
    style = ttk.Style(root); style.theme_use('clam')
    style.configure('TFrame', background=bg)
    style.configure('TLabel', background=bg, foreground=fg, font=('Segoe UI', 11))
    style.configure('TButton', font=('Segoe UI', 10), padding=(12,8))
    style.configure('TCheckbutton', background=bg, foreground=fg, font=('Segoe UI',10))
    style.map('TCheckbutton', background=[('active',bg)])
    style.configure('Treeview', background=panel, fieldbackground=panel, foreground=fg, rowheight=32, font=('Segoe UI',10))
    style.configure('Treeview.Heading', font=('Segoe UI Semibold',10))
    style.configure('TProgressbar', troughcolor=panel, background=accent)
    body=ttk.Frame(root, padding=24);body.pack(fill='both',expand=True)
    ttk.Label(body,text='Pocket Video',font=('Segoe UI Semibold',25)).pack(anchor='w')
    ttk.Label(body,text='Smaller files. Same adventures. Everything stays on this PC.',foreground=muted).pack(anchor='w',pady=(3,16))
    drop=tk.Label(body,text='Drop recordings here\nor click to browse',bg=panel,fg=accent,font=('Segoe UI Semibold',15),height=3,cursor='hand2',relief='flat')
    drop.pack(fill='x')
    options=ttk.Frame(body);options.pack(fill='x',pady=(16,10))
    ttk.Label(options,text='Target size').grid(row=0,column=0,sticky='w')
    target=tk.StringVar(value='24 MB · balanced')
    presets=ttk.Combobox(options,textvariable=target,values=['9 MB · smaller','24 MB · balanced','49 MB · clearer','Custom'],state='readonly',width=20)
    presets.grid(row=1,column=0,padx=(0,12),pady=5,sticky='w')
    custom=tk.StringVar(value='24')
    custom_box=ttk.Entry(options,textvariable=custom,width=7,state='disabled');custom_box.grid(row=1,column=1,padx=(0,12))
    ttk.Label(options,text='Max resolution').grid(row=0,column=2,sticky='w')
    resolution=tk.StringVar(value='720p')
    res_box=ttk.Combobox(options,textvariable=resolution,values=['720p','1080p'],state='readonly',width=10);res_box.grid(row=1,column=2,padx=(0,18))
    audio=tk.BooleanVar(value=True)
    keep=ttk.Checkbutton(options,text='Keep audio',variable=audio);keep.grid(row=1,column=3,sticky='w')
    presets.bind('<<ComboboxSelected>>',lambda e:custom_box.configure(state='normal' if target.get()=='Custom' else 'disabled'))
    table_frame=ttk.Frame(body);table_frame.pack(fill='both',expand=True,pady=(0,8))
    tree=ttk.Treeview(table_frame,columns=('name','size','state'),show='headings',selectmode='browse',height=5)
    for col,title,width in [('name','Recording',380),('size','Size',125),('state','Status',175)]:
        tree.heading(col,text=title);tree.column(col,width=width,minwidth=60,stretch=col=='name')
    tree.pack(side='left',fill='both',expand=True)
    scroll=ttk.Scrollbar(table_frame,orient='vertical',command=tree.yview);scroll.pack(side='right',fill='y');tree.configure(yscrollcommand=scroll.set)
    status=tk.StringVar(value='Choose a preset, drop your files, then press Compress.')
    ttk.Label(body,textvariable=status,wraplength=750).pack(anchor='w',pady=(5,7))
    bar=ttk.Progressbar(body,maximum=100);bar.pack(fill='x')
    actions=ttk.Frame(body);actions.pack(fill='x',pady=(14,8))
    compress_button=ttk.Button(actions,text='Compress queue');compress_button.pack(side='left')
    cancel_button=ttk.Button(actions,text='Cancel',state='disabled');cancel_button.pack(side='left',padx=7)
    open_button=ttk.Button(actions,text='Open output folder',state='disabled');open_button.pack(side='right')
    clear_button=ttk.Button(actions,text='Clear finished');clear_button.pack(side='right',padx=7)
    ttk.Label(body,text='Originals stay untouched. MP4 copies appear beside each source in Shared/.',foreground=muted,font=('Segoe UI',9)).pack(anchor='w')
    ttk.Label(body,text='Limits vary by service; these are size budgets, not platform guarantees.',foreground=muted,font=('Segoe UI',9)).pack(anchor='w')
    records={}; events=queue.Queue(); state={'busy':False,'engine':None,'last':None,'closing':False}
    def add_files(files):
        if state['busy']:
            status.set('Wait for this batch or cancel it before adding more files.');return
        bad=[]
        for file in files:
            p=pathlib.Path(file).expanduser()
            if not p.is_file() or p.suffix.lower() not in EXTENSIONS: bad.append(p.name);continue
            p=p.resolve()
            if any(r['path']==p for r in records.values()):continue
            iid=tree.insert('', 'end',values=(p.name,f'{p.stat().st_size/1e6:.1f} MB','Queued'))
            records[iid]={'path':p,'status':'Queued','output':None}
        status.set('Unsupported files skipped: '+', '.join(bad[:2]) if bad else f'{len(records)} recording(s) ready. Choose Compress queue.')
    def browse(event=None):add_files(filedialog.askopenfilenames(title='Choose recordings',filetypes=[('Video','*.mp4 *.mkv *.mov *.avi *.webm *.m4v *.wmv'),('All files','*.*')]))
    def dropped(event):
        add_files(root.tk.splitlist(event.data));return 'copy'
    root.drop_target_register(DND_FILES);root.dnd_bind('<<Drop>>',dropped)
    drop.drop_target_register(DND_FILES);drop.dnd_bind('<<Drop>>',dropped);drop.bind('<Button-1>',browse)
    tree.drop_target_register(DND_FILES);tree.dnd_bind('<<Drop>>',dropped)
    def open_output():
        selected=tree.selection();entry=records.get(selected[0]) if selected else None
        output=entry.get('output') if entry else state['last']
        if not output:output=state['last']
        if output:os.startfile(str(pathlib.Path(output).parent))
    def clear_finished():
        if state['busy']:return
        for iid in list(records):
            if records[iid]['status']!='Queued':tree.delete(iid);del records[iid]
    def work(batch,target_mb,height,keep_audio):
        completed=0
        try:
            engine=state['engine']
            for index,(iid,source) in enumerate(batch):
                if engine.cancelled.is_set():break
                events.put(('begin',iid,index+1,len(batch)))
                try:
                    result=engine.compress(source,target_mb,height,keep_audio,lambda p,s:events.put(('progress',p,s)))
                    completed+=1;events.put(('done',iid,result))
                except Cancelled:
                    events.put(('cancelled',iid));break
                except Exception as error:
                    logging.exception('Compression failed: %s',source);events.put(('error',iid,str(error)))
        finally:events.put(('finished',completed))
    def options_changed(event=None):
        if state['busy']:return
        custom_box.configure(state='normal' if target.get()=='Custom' else 'disabled')
        for iid,r in records.items():
            if r['status']=='Done':r['status']='Queued';tree.set(iid,'state','Queued · new settings')
        if records:status.set('New settings selected. Compress queue to make a fresh copy.')
    presets.bind('<<ComboboxSelected>>',options_changed)
    res_box.bind('<<ComboboxSelected>>',options_changed)
    keep.configure(command=options_changed)
    custom_box.bind('<FocusOut>',options_changed)
    def start():
        if state['busy']:return
        try:
            value=float(custom.get()) if target.get()=='Custom' else float(target.get().split()[0])
            if not 1<=value<=500:raise ValueError()
        except ValueError:messagebox.showerror('Target size','Enter a target between 1 and 500 MB.');return
        batch=[(iid,r['path']) for iid,r in records.items() if r['status'] in ('Queued','Error','Cancelled')]
        if not batch:browse();return
        try:state['engine']=Compressor()
        except Exception as e:messagebox.showerror('Compressor unavailable',str(e));return
        state['busy']=True
        for button in (compress_button,clear_button):button.configure(state='disabled')
        cancel_button.configure(state='normal');presets.configure(state='disabled');res_box.configure(state='disabled');keep.configure(state='disabled');custom_box.configure(state='disabled')
        threading.Thread(target=work,args=(batch,value,int(resolution.get()[:-1]),audio.get()),daemon=True).start()
    def cancel():
        if state['engine']:state['engine'].cancel();status.set('Cancelling… your originals are safe.')
    def close():
        if state['busy']:state['closing']=True;cancel()
        else:root.destroy()
    def drain():
        try:
            while True:
                event=events.get_nowait();kind=event[0]
                if kind=='begin':
                    _,iid,n,total=event;records[iid]['status']='Working';tree.set(iid,'state',f'Working · {n}/{total}');tree.selection_set(iid);tree.see(iid);bar['value']=0
                elif kind=='progress':bar['value']=event[1]*100;status.set(event[2])
                elif kind=='done':
                    _,iid,r=event;records[iid].update(status='Done',output=r['output']);state['last']=r['output'];tree.set(iid,'size',f"{r['before']/1e6:.1f} → {r['after']/1e6:.1f} MB");tree.set(iid,'state','Already small enough' if r['skipped'] else 'Ready to share');open_button.configure(state='normal');bar['value']=100
                elif kind in ('error','cancelled'):
                    iid=event[1];records[iid]['status']='Error' if kind=='error' else 'Cancelled';tree.set(iid,'state',records[iid]['status'])
                    if kind=='error':status.set(event[2]);records[iid]['error']=event[2]
                elif kind=='finished':
                    state['busy']=False;state['engine']=None
                    if state['closing']:root.destroy();return
                    compress_button.configure(state='normal');clear_button.configure(state='normal');cancel_button.configure(state='disabled');presets.configure(state='readonly');res_box.configure(state='readonly');keep.configure(state='normal');custom_box.configure(state='normal' if target.get()=='Custom' else 'disabled')
                    errors=[r for r in records.values() if r['status']=='Error']
                    status.set(errors[-1].get('error','Check logs.') if errors else ('Cancelled. Finished copies were kept; press Compress queue to retry.' if any(r['status']=='Cancelled' for r in records.values()) else f"{event[1]} ready to share. Select a row and open its output folder."))
        except queue.Empty:pass
        root.after(80,drain)
    compress_button.configure(command=start);cancel_button.configure(command=cancel);open_button.configure(command=open_output);clear_button.configure(command=clear_finished)
    root.protocol('WM_DELETE_WINDOW',close)
    root.report_callback_exception=lambda t,e,tb:(logging.error('GUI failure',exc_info=(t,e,tb)),messagebox.showerror('Something went wrong',f'{e}\n\nDetails: {LOG_FILE}'))
    add_files(paths);root.after(80,drain);root.mainloop()

def main():
    parser=argparse.ArgumentParser(description='Local drag-and-drop shareable video compressor')
    parser.add_argument('files',nargs='*');parser.add_argument('--headless',action='store_true');parser.add_argument('--target-mb',type=float,default=24);parser.add_argument('--height',type=int,choices=[720,1080],default=720);parser.add_argument('--mute',action='store_true')
    args=parser.parse_args()
    if args.headless:
        if not args.files:parser.error('provide at least one video')
        for file in args.files:
            result=Compressor().compress(file,args.target_mb,args.height,not args.mute,lambda p,s:print(f'{p:.0%} {s}',flush=True))
            print(json.dumps(result),flush=True)
    else:gui(args.files)

if __name__=='__main__':
    try:main()
    except Exception as error:
        logging.exception('Fatal compressor error')
        if '--headless' in sys.argv:raise
        import tkinter as tk
        from tkinter import messagebox
        r=tk.Tk();r.withdraw();messagebox.showerror('Pocket Video could not start',f'{error}\n\nLog: {LOG_FILE}');r.destroy()
        sys.exit(1)
