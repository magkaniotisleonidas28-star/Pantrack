'use client';
import {useEffect,useState} from 'react';

export function useWorkspaceTheme(){
  const [theme,setTheme]=useState<'light'|'dark'>('light'),[ready,setReady]=useState(false);
  useEffect(()=>{try{if(localStorage.getItem('pantrack-workspace-theme')==='dark')setTheme('dark');}catch{}setReady(true);},[]);
  useEffect(()=>{
    if(!ready)return;
    document.body.dataset.workspaceTheme=theme;
    try{localStorage.setItem('pantrack-workspace-theme',theme);}catch{}
    return()=>{delete document.body.dataset.workspaceTheme;};
  },[theme,ready]);
  return {theme,toggleTheme:()=>setTheme(value=>value==='dark'?'light':'dark')};
}
