import './setup.ts';
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {closeDb} from '@aihot/backend/db';
import {enforceIdentity, finalizeCopy, matchEntityIds} from '@aihot/backend/editorial/writing';
import {ScoreSchema, normalizeAnalysis, type AnalysisRun} from '@aihot/backend/editorial/analyze';
import {editorialText, hasMemberBoundary, PUBLIC_EXCERPT_MARKER} from '../packages/backend/src/content/editorial-material.ts';
import {readable} from '@aihot/backend/content/extract';
import {isPoolEligible} from '@aihot/backend/publication/rules';
import {CATEGORIES, CATEGORY_BY_ITEM_TYPE} from '@aihot/industry/taxonomy';
import {promptText} from '@aihot/backend/editorial/prompts';
after(closeDb);
const scout='https://www.fantasyfootballscout.co.uk/2026/10/02/example';

test('full club aliases survive translation without admitting invented clubs or ordinary words',()=>{
  for(const text of ['Manchester City','MCI']) {
    const copy=enforceIdentity({title:'Injuries',text,sourceKind:'rss'},{titleZh:'伤停更新',summaryZh:'曼城球员的伤情仍待确认。'});
    assert.equal(copy.identityGuard.outcome,'pass');
  }
  assert.deepEqual(matchEntityIds(['new players feel every chance']),[]);
  assert.equal(enforceIdentity({title:'Injuries',text:'A player is injured',sourceKind:'rss'},{titleZh:'伤停更新',summaryZh:'曼城球员受伤。'}).summaryZh,'');
});
test('player comparison retains actual public data beyond an English-name-heavy lead',()=>{
  const summary='Schade（£7.0m）、Harvey Barnes（£7.5m）与Marcus Tavernier（£5.5m）是本轮可考虑的中场选项，公开数据展示了三名球员的射门表现。Schade有12次禁区射门，Tavernier有8次，两人的进球均为3个；后续助攻分析为会员内容，这里只概述公开部分。';
  const copy=finalizeCopy({title:'Schade v Barnes v Tavernier',text:'Player comparison. '.repeat(50),sourceKind:'rss'},{titleZh:'三名中场公开数据对比',summaryZh:summary});
  assert.match(copy.summaryZh,/12次禁区射门/);assert.match(copy.summaryZh,/公开部分/);assert.ok(copy.summaryZh.length<=320);
});
test('Scout cleanup separates promotion and related links from actual editorial evidence',()=>{
  const html='<p>FPL introduces a second chance league on 10 October.</p><p>Read the <a href="/rules">official rules</a> before joining.</p><table><tr><td>Shots</td><td>12</td></tr></table><h2>USE THE SCOUT TOOLKIT</h2><p>Subscribe now for GW6.</p><h2>A POSSIBLE DRAFT</h2><ul><li><a href="/schade">Schade, Barnes, Tavernier</a></li></ul>';
  const text=editorialText({url:scout,bodyHtml:html,bodyText:'fallback'});
  assert.ok(text);
  assert.match(text,/10 October/);assert.match(text,/official rules/);assert.match(text,/Shots.*12/);
  assert.doesNotMatch(text,/Subscribe|Schade|GW6/);
  assert.equal(editorialText({url:'https://example.com',bodyHtml:html,bodyText:'original'}),'original');
});
test('an explicit membership boundary marks the public excerpt without fetching gated text',()=>{
  const html=`<html><head><title>Midfielder comparison</title></head><body><article><h1>Midfielder comparison</h1><p>${'These public shot statistics compare three midfielders and their goal threat. '.repeat(15)}</p><p>This content is restricted to Chief Scout Members.</p></article></body></html>`;
  assert.equal(hasMemberBoundary(html,scout),true);
  assert.equal(hasMemberBoundary(html,'https://example.com'),false);
  assert.ok(readable(html,scout)?.text.includes(PUBLIC_EXCERPT_MARKER));
});
test('rules updates preserve scoring reasons and the existing score contract',()=>{
  const score=ScoreSchema.parse({attentionScore:82,itemType:'rules_update',reason:'New rules with an effective date'});
  assert.equal(score.attentionScore,82);assert.ok(score.reason);
  assert.equal(ScoreSchema.parse({attentionScore:42}).attentionScore,42);
  assert.throws(()=>ScoreSchema.parse({attentionScore:101}));
});
test('a valid low-score article can enter latest news without entering selected or bypassing copy checks',()=>{
  const run:AnalysisRun={prefilter:{label:'PASS',reason:'Rules',model:'stub',receiptId:1,reused:false},scores:{model:'stub',threshold:76,values:[12,12],receiptIds:[2,3],reused:false},structure:null,writing:{kind:'summarize',model:'stub',titleZh:'规则公告',summaryZh:'新规则说明。',reasonZh:null,tags:[],receiptIds:[4],reused:false}};
  const a=normalizeAnalysis(run);
  assert.equal(a.selected,false);assert.equal(a.relevance,'pass');
  assert.equal(isPoolEligible({participationMode:'editorial',relevance:a.relevance,title:a.titleZh,summary:a.summaryZh}),true);
  run.writing!.summaryZh='';
  assert.equal(normalizeAnalysis(run).relevance,'unknown');
});

test('unknown evidence cannot be rescued by a high score or fluent Chinese copy',()=>{
  const run:AnalysisRun={prefilter:{label:'UNKNOWN',reason:'Video not extracted',model:'stub',receiptId:1,reused:false},scores:{model:'stub',threshold:60,values:[90,90],receiptIds:[],reused:false},structure:null,writing:{kind:'summarize',model:'stub',titleZh:'球队新闻',summaryZh:'球队发布了重要消息。',reasonZh:null,tags:[],receiptIds:[],reused:false}};
  let result=normalizeAnalysis(run);
  assert.equal(result.relevance,'unknown');assert.equal(result.selected,false);
  assert.equal(isPoolEligible({participationMode:'editorial',relevance:result.relevance,title:result.titleZh,summary:result.summaryZh}),false);
  run.prefilter.label='BLOCK'; result=normalizeAnalysis(run);
  assert.equal(result.relevance,'block');assert.equal(result.selected,false);
});

test('team reviews and news briefs are distinct categories with one authoritative category tag',()=>{
  assert.equal(CATEGORY_BY_ITEM_TYPE.team_analysis,'球队复盘');assert.equal(CATEGORY_BY_ITEM_TYPE.news_update,'英超快讯');
  assert.equal(CATEGORIES.length,10);
  assert.equal(ScoreSchema.parse({attentionScore:20,itemType:'news_update'}).itemType,'news_update');
  const run:AnalysisRun={prefilter:{label:'PASS',reason:'Report',model:'stub',receiptId:1,reused:false},scores:null,writing:{kind:'understand',model:'stub',titleZh:'球队阶段复盘',summaryZh:'攻防数据与阵容趋势',reasonZh:null,tags:['球员与选人分析','Classic','媒体报道'],receiptIds:[],reused:false},structure:{model:'stub',category:'teams',tags:['球队复盘'],subjects:['bou'],fact:null,receiptId:2,reused:false}};
  assert.deepEqual(normalizeAnalysis(run).tags,['球队复盘','Classic','媒体报道','伯恩茅斯']);
});

test('eligibility policy covers promotional posts and unread media without excluding substantive reviews',()=>{
  const policy=promptText('prefilter');
  for(const phrase of ['赛季合影','国家队','Team news is in','未读取视频','xG/xGC','正式奖项','UNKNOWN 暂缓发布']) assert.ok(policy.includes(phrase),phrase);
});
