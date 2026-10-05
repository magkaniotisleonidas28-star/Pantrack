'use client';

import {useId,type ReactNode} from 'react';
import './task-form.css';

export function TaskSection({title,description,children}:{title:string;description?:string;children:ReactNode}) {
  const id=useId();
  return <section className="task-section" aria-labelledby={id}>
    <div className="task-section-heading"><h3 id={id}>{title}</h3>{description&&<p>{description}</p>}</div>
    <div className="task-section-fields">{children}</div>
  </section>;
}

export function ChoiceField<T extends string>({label,value,onChange,options,compact=false}:{
  label:string;value:T;onChange:(value:T)=>void;options:{value:T;label:string;description?:string}[];compact?:boolean;
}) {
  const name=useId();
  return <fieldset className={'task-choices'+(compact?' task-choices-compact':'')}><legend>{label}</legend>
    {options.map(option=><label className="task-choice" key={option.value}>
      <input type="radio" name={name} checked={value===option.value} value={option.value} onChange={()=>onChange(option.value)}/>
      <span><strong>{option.label}</strong>{option.description&&<small>{option.description}</small>}</span>
    </label>)}
  </fieldset>;
}
