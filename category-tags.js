/** One-time user-requested problem-domain labels. Boards/frames remain independent. */
const clone = data => JSON.parse(JSON.stringify(data));
export const DOMAIN_TAGS = [
  {
    "id": "domain-r",
    "name": "R 资源与推理效率",
    "color": "#9b8671",
    "rank": 0
  },
  {
    "id": "domain-p",
    "name": "P 预测效果与泛化",
    "color": "#6284a0",
    "rank": 1
  },
  {
    "id": "domain-k",
    "name": "K 特征、知识与输入能力",
    "color": "#668777",
    "rank": 2
  },
  {
    "id": "domain-e",
    "name": "E 部署与运行环境",
    "color": "#8c8981",
    "rank": 3
  },
  {
    "id": "domain-m",
    "name": "M 数据生成与模型规格",
    "color": "#9080a1",
    "rank": 4
  },
  {
    "id": "domain-c",
    "name": "C 因果能力",
    "color": "#b18b50",
    "rank": 5
  },
  {
    "id": "domain-a",
    "name": "A 协作与资产",
    "color": "#738b91",
    "rank": 6
  }
];
const previousDefaults = {
  "delivery-validation": "交付验证",
  "data-comparison": "数据对照",
  "scope-alignment": "范围对齐",
  "scenario-justification": "场景论证",
  "deferred-review": "后置重评",
  "asset-maintenance": "资产沉淀",
  "meeting-source": "会议资料",
  "mechanism-fusion": "机理融合",
  "resource-tradeoff": "资源取舍",
  "long-term-exploration": "长期探索"
};
export const PROJECT_DOMAINS = {
  "7135496756": [
    "R",
    "P"
  ],
  "6962297566": [
    "R"
  ],
  "6962172098": [
    "R"
  ],
  "7018500789": [
    "P"
  ],
  "7133205159": [
    "A"
  ],
  "7135469627": [
    "P"
  ],
  "6989747197": [
    "P"
  ],
  "7131325852": [
    "P"
  ],
  "6989023658": [
    "P"
  ],
  "7132006442": [
    "P"
  ],
  "6989896654": [
    "P"
  ],
  "7134500575": [
    "K"
  ],
  "6961865664": [
    "K"
  ],
  "6998770550": [
    "K"
  ],
  "6985308324": [
    "K"
  ],
  "6989963650": [
    "K"
  ],
  "6985473599": [
    "M"
  ],
  "6961890662": [
    "M"
  ],
  "6980097253": [
    "A"
  ],
  "6961881183": [
    "A"
  ],
  "7045165610": [
    "C"
  ],
  "6962286552": [
    "R"
  ],
  "6962195614": [
    "M"
  ],
  "local-direction-lower-vram": [
    "R"
  ]
};

export function applyDomainTags(input) {
  const data=clone(input);
  const noteUpdates=new Map([
    ['流式推理加速已有证据重点是速度/缓存复用，不能自动认定是降显存子方案；插补与显存优化属于取舍，不是降显存方案。两者保留资源取舍标签，不新增主小挂载。','流式推理归资源与推理效率，插补归预测效果与泛化；资源取舍留在讨论内容中，不据此建立主小挂载。'],
    ['标签是展示/跟进建议，不是流程状态或优先级；7 个动作标签沿用 10/27 跟进分组。资源取舍与长期探索来自会中讨论；交付日期、优先级和当前状态仍分别核实。','分类标签按问题域组织，独立于行动看板和画框名称；标签不表示优先级、交付承诺或流程状态。']
  ]);
  if(Array.isArray(data.organizationNotes))data.organizationNotes=data.organizationNotes.map(note=>noteUpdates.get(note)||note);
  if(data.domainTagVersion===1)return data;
  if(data.domainTagVersion!==undefined)throw Error('不支持此分类标签版本');
  const oldDefaults=new Set(data.tags.filter(t=>previousDefaults[t.id]===t.name).map(t=>t.id));
  const neededByUnmapped=new Set(data.projects.filter(p=>!Object.hasOwn(PROJECT_DOMAINS,p.id)).flatMap(p=>p.tagIds));
  const retained=data.tags.filter(t=>!oldDefaults.has(t.id)||neededByUnmapped.has(t.id));
  const used=new Set(retained.map(t=>t.id)), categoryIds={}, standardIds=new Set();
  for(const template of DOMAIN_TAGS){
    let tag=retained.find(t=>t.name.toLocaleLowerCase()===template.name.toLocaleLowerCase());
    if(!tag){let id=template.id,suffix=2;while(used.has(id))id=template.id+'-'+suffix++;tag={...template,id};retained.push(tag);used.add(id);}
    tag.rank=template.rank;categoryIds[template.name[0]]=tag.id;standardIds.add(tag.id);
  }
  retained.filter(t=>!standardIds.has(t.id)).sort((a,b)=>(a.rank??999)-(b.rank??999)).forEach((t,i)=>t.rank=DOMAIN_TAGS.length+i);
  data.tags=retained;
  for(const project of data.projects){
    const mapped=Object.hasOwn(PROJECT_DOMAINS,project.id);
    const current=project.tagIds.filter(id=>!mapped||!oldDefaults.has(id));
    const domains=(PROJECT_DOMAINS[project.id]||[]).map(code=>categoryIds[code]);
    project.tagIds=[...new Set([...domains,...current])];
  }
  data.domainTagVersion=1;
  return data;
}
