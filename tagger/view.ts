// deno-lint-ignore-file no-unused-vars, no-explicit-any, no-unreachable, no-window

import * as model from "./model.ts";
import {FieldVisitorI, Field, ScalarField, BooleanField, IntegerField, FloatField,
        StringField, EnumField, VariantField, BlobField, AudioField, ImageField,
        IdField, PrimaryKeyField, RelationField, Schema} from "./model.ts";
import {Assertion, getAssertionPath, parentAssertionPath, getAssertionPathFields, assertionPathToFields} from './schema.ts';
import {unwrap, panic} from "../utils/utils.ts";
import {Markup} from '../utils/markup.ts';
import {VersionedDb, CurrentTupleQuery, CurrentRelationQuery, TupleVersion, generateBeforeOrderKey, generateAfterOrderKey} from './workspace.ts';
import * as workspace from './workspace.ts';
import {getAssertionsForEntry} from './workspace.ts';
import * as utils from '../utils/utils.ts';
import * as strings from '../utils/strings.ts';
import { rpc } from '../utils/rpc.ts';
import {block} from "../utils/strings.ts";
import {dictSchemaJson} from "./entry-schema.ts";
import * as timestamp from "../utils/timestamp.ts";
import { renderToStringViaLinkeDOM } from '../utils/markup.ts';
import { BEGINNING_OF_TIME, END_OF_TIME } from "../utils/timestamp.ts";
import { db, Db, PreparedQuery, assertDmlContainsAllFields, boolnum, defaultDbPath } from "./db.ts";
// export function buildView(schema: Schema): SchemaView {
//     // return new RelationSQLDriver(db, relationField,
//     //                              relationField.relationFields.map(r=>buildRelationSQLDriver(db, r)));
//     throw new Error();
// }

/**
 *
 */
export abstract class View {

    prompt: string|undefined;

    constructor(public field: Field) {
        this.prompt = field.style.$prompt ??
            strings.capitalize(field.name).replaceAll('_', ' ');
    }

    abstract accept<A,R>(v: ViewVisitorI<A,R>, a: A): R;
}

/**
 *
 */
export abstract class ScalarView extends View {
    declare field: ScalarField;
    constructor(field: ScalarField) { super(field); }

    renderView(v: any): Markup {
        return String(v);
    }

    /*abstract*/ renderEditor(relation_id: number, v: any): Markup {
        //throw new Error(`renderEditor not implemented on ${utils.className(this)}`);

        return String(v);
    }

    loadFromEditor(relation_id: number): any {
        return undefined;
    }
}

/**
 *
 */
export class BooleanView extends ScalarView {
    declare field: BooleanField;
    constructor(field: BooleanField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitBooleanView(this, a); }

    renderView(v: any): Markup {
        // This should be values on the style $
        return String(v);
    }

    renderEditor(relation_id: number, v: any): Markup {
        const checkboxAttrs: Record<string,string> = {
            type: 'checkbox',
            id: `input-${relation_id}-${this.field.name}`};
        if(v) checkboxAttrs['checked'] = '';
        return ['input', checkboxAttrs];
    }

    loadFromEditor(relation_id: number): any {
        const inputId = `input-${relation_id}-${this.field.name}`;
        const checkboxElement = document.getElementById(inputId) as HTMLInputElement;
        if(!checkboxElement)
            throw new Error(`failed to find checkbox element ${inputId}`); // TODO fix error
        const checkboxValue = checkboxElement.checked;
        console.info('Checkbox value', checkboxValue);
        return checkboxValue;
    }

}

/**
 *
 */
export class IntegerView extends ScalarView {
    declare field: IntegerField;
    constructor(field: IntegerField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitIntegerView(this, a); }

    renderView(v: any): Markup {
        console.info('in IntegerView.renderView();');
        console.info('  style is ', this.field.style);
        console.info('  shape is ', this.field.style.$shape, 'for', this.field.name);
        // XXX this very much does not belong here XXX FIX FIX FIX XXX
        switch(this.field.style.$shape) {
            case 'boundingGroup': // XXX MASSIVE HACK FOR DEMO - DO THIS RIGHT
                console.info('ding the thing');
                return (
                    ['div', {},
                     ['object', {data:`/renderStandaloneGroupAsSvgResponse(${v})`, 'type':'image/svg+xml'}]]);
            default:
                return super.renderView(v);
        }
    }
}

/**
 *
 */
export class FloatView extends ScalarView {
    declare field: FloatField;
    constructor(field: FloatField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitFloatView(this, a); }
}

/**
 *
 */
export class StringView extends ScalarView {
    declare field: StringField;
    constructor(field: StringField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitStringView(this, a); }

    // TODO: how to know what width to use - easy if one - want full width, but
    //       if multiple?
    // -- give id.
    // -- write a loader that can get the value based on id.
    // -- before writing this, do the other end
    renderEditor(relation_id: number, v: any): Markup {
        return ['input', {type: 'text', placeholder: this.prompt,
                          size: this.field.style.$width ?? 30,
                          value: String(v??''),
                          id: `input-${relation_id}-${this.field.name}`}];
    }

    loadFromEditor(relation_id: number): any {
        const inputId = `input-${relation_id}-${this.field.name}`;
        const inputElement = document.getElementById(inputId);
        if(!inputElement)
            throw new Error(`failed to find input element ${inputId}`); // TODO fix error
        const value = (inputElement as HTMLInputElement).value; //getAttribute('value');
        // TODO more checking here.
        return value;
    }
}

/**
 *
 */
export class EnumView extends StringView {
    declare field: EnumField;
    constructor(field: EnumField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitEnumView(this, a); }

    get choices(): Record<string, string> {
        // XXX Fix this garbage typing
        return (((this.field.style as any).$options
            ?? panic(`enum ${this.field.name} missing options`)) as Record<string, string>);
    }

    renderView(v: any): Markup {
        return this.choices[v] ?? String(v);
    }

    renderEditor(relation_id: number, val: any): Markup {
        //size: this.field.style.$width ?? 30,


        return ['select', {type: 'text', placeholder: this.prompt,
                           id: `input-${relation_id}-${this.field.name}`},
                Object.entries(this.choices).map(([k,v])=>
                    ['option',
                     {value: k, ...(val===k?{selected:''}:{})}, v])
               ];
    }

    loadFromEditor(relation_id: number): any {
        const inputId = `input-${relation_id}-${this.field.name}`;
        const selectElement = document.getElementById(inputId) as HTMLSelectElement;
        if(!selectElement)
            throw new Error(`failed to find select element ${inputId}`); // TODO fix error
        const selectValue = selectElement.options[selectElement.selectedIndex].value;
        console.info('Select value', selectValue);
        return selectValue;
    }
}

/**
 *
 */
export class VariantView extends StringView {
    declare field: VariantField;
    constructor(field: VariantField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitVariantView(this, a); }
}

/**
 *
 */
export class BlobView extends StringView {
    declare field: BlobField;
    constructor(field: BlobField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitBlobView(this, a); }
}

/**
 *
 */
export class AudioView extends StringView {
    declare field: AudioField;
    constructor(field: AudioField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitAudioView(this, a); }
}

/**
 *
 */
export class ImageView extends StringView {
    declare field: ImageField;
    constructor(field: ImageField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitImageView(this, a); }
}

/**
 *
 */
export class IdView extends ScalarView {
    declare field: IdField;
    constructor(field: IdField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitIdView(this, a); }
}

/**
 *
 */
export class PrimaryKeyView extends ScalarView {
    declare field: PrimaryKeyField;
    constructor(field: PrimaryKeyField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitPrimaryKeyView(this, a); }
}

/**
 *
 */
export class RelationView extends View {
    declare field: RelationField;
    #nonRelationViews: View[]|undefined = undefined;
    #scalarViews: ScalarView[]|undefined = undefined;
    #userScalarViews: ScalarView[]|undefined = undefined;
    #relationViews: RelationView[]|undefined = undefined;
    #relationViewsByTag: Record<string, RelationView>|undefined = undefined;
    //#ancestorRelations_: RelationView[]|undefined;
    #descendantAndSelfRelationViews_: RelationView[]|undefined;

    constructor(field: RelationField, public views: View[]) {
        super(field);
        //field.fields.map(new FieldVisitor<never,View>
    }

    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitRelationView(this, a); }

    get nonRelationViews(): View[] {
        return this.#nonRelationViews??=this.views.filter(f=>!(f instanceof RelationView));
    }

    get scalarViews(): ScalarView[] {
        return this.#scalarViews??=
            this.views.filter(f=>f instanceof ScalarView).map(f=>f as ScalarView);
    }

    get userScalarViews(): ScalarView[] {
        return this.#scalarViews??=
            this.scalarViews.filter(f=>!(f instanceof PrimaryKeyView));
    }

    get relationViews(): RelationView[] {
        return this.#relationViews??=
            this.views.filter(f=>f instanceof RelationView).map(f=>f as RelationView);
    }

    get relationViewsByTag(): Record<string, RelationView> {
        // Note: we are already validating tag uniqueness across the whole
        //       schema, so no need to check here as well.
        return this.#relationViewsByTag??=
            Object.fromEntries(this.relationViews.map(r=>[r.field.tag, r]));
    }

    get descendantAndSelfRelationViews(): RelationView[] {
        return this.#descendantAndSelfRelationViews_ ??= [this, ...this.descendantRelationViews];
    }

    get descendantRelationViews(): RelationView[] {
        return ([] as RelationView[]).concat(
            ...this.relationViews.map(r=>r.descendantAndSelfRelationViews));
    }

    // get relationViewForRelation(): Map<RelationView, RelationView> {
    //     return this.#relationViewForRelation = (()=>{
    //         return new Map();
    //     })();
    // }

    // getRelationViewByName(relationName: string): RelationView {
    //     return this.relationViewForRelation.get(
    //         this.schema.relationsByName[relationName] ?? panic('missing', relationName))
    //         ?? panic();
    // }

    // getRelationViewByTag(relationTag: string): RelationView {
    //     return this.relationViewForRelation.get(
    //         this.schema.relationsByTag[relationTag] ?? panic('missing', relationTag))
    //         ?? panic();
    // }

}

/**
 *
 */
export class SchemaView extends RelationView {
    declare field: Schema;
    #relationViewForRelation: Map<RelationField, RelationView>|undefined = undefined;

    constructor(public schema: Schema, views: View[]) {
        super(schema, views);
    }

    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitSchemaView(this, a); }

    get relationViewForRelation(): Map<RelationField, RelationView> {
        return this.#relationViewForRelation ??=
            new Map(this.descendantAndSelfRelationViews.map(v=>[v.field, v]));
    }
}

/**
 *
 */
export interface ViewVisitorI<A,R> {
    visitBooleanView(f: BooleanView, a: A): R;
    visitIntegerView(f: IntegerView, a: A): R;
    visitFloatView(f: FloatView, a: A): R;
    visitStringView(f: StringView, a: A): R;
    visitEnumView(f: EnumView, a: A): R;
    visitVariantView(f: VariantView, a: A): R;
    visitBlobView(f: BlobView, a: A): R;
    visitAudioView(f: AudioView, a: A): R;
    visitImageView(f: ImageView, a: A): R;
    visitIdView(f: IdView, a: A): R;
    visitPrimaryKeyView(f: PrimaryKeyView, a: A): R;
    visitRelationView(f: RelationView, a: A): R;
    visitSchemaView(f: SchemaView, a: A): R;
}

/**
 *
 * Need multiple versions of render visitor.
 */
export class RenderVisitor implements ViewVisitorI<any,Markup> {

    visitView(f: View, v: any): Markup {
        // TODO this will be an exception later.
        return `[[Unrendered field kind ${utils.className(f)}]]`;
    }

    visitBooleanView(f: BooleanView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitIntegerView(f: IntegerView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitFloatView(f: FloatView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitStringView(f: StringView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitEnumView(f: EnumView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitVariantView(f: VariantView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitBlobView(f: BlobView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitAudioView(f: AudioView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitImageView(f: ImageView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitIdView(f: IdView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitPrimaryKeyView(f: PrimaryKeyView, v: any) {
        return this.visitView(f, v);
    }

    visitRelationView(r: RelationView, v: CurrentRelationQuery): Markup {
        //r.modelFields.forEach(f=>f.accept(this, v[f.name]));
    }

    visitSchemaView(schema: SchemaView, v: any): Markup {
        return this.visitRelationView(schema, v);
    }
}

// export function renderRelation(r: CurrentRelationQuery): Markup {
//     const id=`relation-${r.schema.name}-${r.src.parent?.id ?? 0}`;
//     return (
//         ['table', {class: 'relation relation-${r.src.schema.name}', id},
//          [...r.tuples.values()].map(t=>
//              ['tr', {},
//               ['th', {}, t.schema.name],
//               //tv.schema.[lookup view for schema].map()
//              ])
//         ]);
// }

// For example, called on a dictionary entry (or root)
// What is a nice rendering?
/**
 * Tuple is rendered as a table with two options:
 * - show history - multi-rows with one per history item.
 * - edit mode - editor for current item (with prev value
 *   shown in history if history is open)
 * - later, may add more control of what items are displayed
 *   in history.
 * - no labels on fields for now (dictionary entries are simple enough).
 */
// - history should have a different font/weight etc - but need to
//   be in same table for layout.
// - editing of current uses same table (also for layout)
// - nested tuples are separate tables.
// - COMPLICATION: multiple tuples in a relation should be on one table (will
//   look ragged otherwise).
// - this will force the prompts into the table.
// - so use a colspan to embed the child items table in the parent table.
// - so the scope of render needs to be larger that a single tuple.
// - the scope of the entity that is rendered is a relation (recursively)


// XXX Also need to refactor this to allow rendering starting at any subtree.
//     (for post change rerender).

/**
 *
 */
export class ActiveViews {
    workspace: VersionedDb;
    activeViews: Map<string, ActiveView> = new Map();
    currentlyOpenTupleEditor: TupleEditor|undefined = undefined;

    constructor(workspace: VersionedDb) {
        this.workspace = workspace;
    }

    nextTime(): number {
        // This is not necc ahead of all the server timestamps, just ahead
        // of all the timestamps in the current workspace.  Once we are live
        // following, this will need redoing XXX
        return timestamp.nextTime(this.workspace.mostRecentLocalTimestamp);
    }

    applyAssertion(assertion: Assertion) {
        // TODO Should check if differnt than prev tuple TODO TODO
        // - what from and to times to use for new assertions.
        //newAssertion =
        this.workspace.applyProposedAssertion(assertion);


        // THIS IS JUST FOR TEST - IT IS BAD!!! - WE ARE bAD !!!
        (async ()=>{
            try {
                await rpc`wordwiki.applyTransactions(${[assertion]})`;
            } catch (e) {
                alert(`Failed to save change - got error ${e}`);
                throw e;
            }
        })();
    }

    /**
     * Note: this is part of a temporary saving model for the proto versin -
     * the workspace must be droppped after saving changes in this manner.
     * TEMPORARY TEMP TEMP XXX
     */
    async saveChanges() {
        console.info('--- Saving changes');
        try {
            await this.workspace.persistProposedAssertions();
            console.info('--- Done saving changes');
        } catch(e) {
            alert(`Failed to save changes: ${e}`);
            throw e;
        }

        // TODO do something nicer!!!
        location.reload();
    }

    viewByName(viewName: string): ActiveView {
        return this.activeViews.get(viewName)
            ?? panic('unable to find active view', viewName);
    }

    registerActiveView(activeView: ActiveView) {
        this.activeViews.set(activeView.id, activeView);
    }

    rerenderAllViews() {
        for(const activeView of this.activeViews.values())
            activeView.rerender();
    }

    rerenderViewById(viewId: string) {
        this.activeViews.get(viewId)?.rerender();
    }

    getCurrentlyOpenTupleEditorForTupleId(renderRootId: string, tuple_id: number): TupleEditor|undefined {
        return (this.currentlyOpenTupleEditor !== undefined &&
            this.currentlyOpenTupleEditor.renderRootId === renderRootId &&
            this.currentlyOpenTupleEditor.ref_tuple_id === tuple_id)
            ? this.currentlyOpenTupleEditor
            : undefined;
    }

    getCurrentlyOpenTupleEditorForRenderRootId(renderRootId: string): TupleEditor|undefined {
        return (this.currentlyOpenTupleEditor !== undefined &&
            this.currentlyOpenTupleEditor.renderRootId === renderRootId)
            ? this.currentlyOpenTupleEditor
            : undefined;
    }

    editNewAbove(renderRootId: string, db_tag: string, tuple_tag: string, tuple_id: number) {
        this.editNewPeer(renderRootId, db_tag, tuple_tag, tuple_id, 'before');
    }

    editNewBelow(renderRootId: string, db_tag: string, tuple_tag: string, tuple_id: number) {
        this.editNewPeer(renderRootId, db_tag, tuple_tag, tuple_id, 'after');
    }

    editNewFirstChild(renderRootId: string, db_tag: string, tuple_tag: string, tuple_id: number, child_tag: string) {
        this.editNewChild(renderRootId, db_tag, tuple_tag, tuple_id, 'firstChild', child_tag);
    }

    editNewLastChild(renderRootId: string, db_tag: string, tuple_tag: string, tuple_id: number, child_tag: string) {
        this.editNewChild(renderRootId, db_tag, tuple_tag, tuple_id, 'lastChild', child_tag);

    }

    editNewPeer(renderRootId: string,
                refDbTag: string, refTupleTag: string, refTupleId: number,
                refKind: 'before'|'after') {

        // --- Find the reference tuple
        const refTuple = this.workspace.getVersionedTupleById(
            refDbTag, refTupleTag, refTupleId)
            ?? panic('cannot find ref tuple for edit', refTupleId);

        const refAssertion = refTuple.mostRecentTuple?.assertion
            ?? panic('cannot use ref tuple', refTupleId);
        const newTupleSchema = refTuple.schema;

        //const mostRecentTupleVersion = refTuple.mostRecentTuple;
        const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

        //const activeView = this.activeViews.get(renderRootId)
        const parent = this.workspace.getVersionedTupleParentRelation(
            getAssertionPath(refTuple.requiredMostRecentTuple.assertion));
        const order_key = refKind === 'before'
            ? generateBeforeOrderKey(parent, refTupleId)
            : generateAfterOrderKey(parent, refTupleId);

        // TODO make this new assertion making less raw.
        const newAssertion: Assertion = Object.assign(
            {},
            getAssertionPathFields(refAssertion),
            {
                ty: refAssertion.ty,
                assertion_id: id,
                valid_from: BEGINNING_OF_TIME,  // This is wrong - but it is overridden
                valid_to: END_OF_TIME,
                [`id${newTupleSchema.ancestorRelations.length}`]: id,
                id: id,
                order_key,
            });

        console.info('REF assertion', refAssertion);
        console.info('NEW assertion', newAssertion);

        this.openFieldEdit(renderRootId, refKind, undefined, refDbTag, refTupleTag, refTupleId, newAssertion);
    }

    editNewChild(renderRootId: string,
                 refDbTag: string, refTupleTag: string, refTupleId: number,
                 refKind: TupleRefKind, childTag: string) {

        // --- Find the reference tuple
        const parentTuple = this.workspace.getVersionedTupleById(
            refDbTag, refTupleTag, refTupleId)
            ?? panic('cannot find tuple for edit', refTupleId);

        // --- Find child relation we are inserting into
        const parentRelation = parentTuple.childRelations[childTag]
            ?? panic('cannot find child relation for edit', childTag);

        // ---
        const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

        // --- Position is tricky
        const order_key = workspace.generateAtEndOrderKey(parentRelation);

        // --- Make new child assertion
        // TODO make this new assertion making less raw.
        const newAssertion: Assertion = Object.assign(
            {},
            assertionPathToFields([...getAssertionPath(parentTuple.currentAssertion??panic()), [childTag, id]]),
            {
                ty: childTag,
                assertion_id: id,
                valid_from: BEGINNING_OF_TIME,  // This is wrong - but it is overridden
                valid_to: END_OF_TIME,
                id: id,
                order_key,
            });

        console.info('NEW assertion', newAssertion);

        this.openFieldEdit(renderRootId, refKind, parentRelation.schema.tag, refDbTag, refTupleTag, refTupleId, newAssertion);
    }

    editNew(renderRootId: string,
            refDbTag: string, refTupleTag: string, refTupleId: number,
            refKind: TupleRefKind, schema: RelationField) {


    }

    editTupleUpdate(renderRootId: string, refDbTag: string, refTupleTag: string, refTupleId: number) {

        // --- Find the reference tuple
        const refTuple = this.workspace.getVersionedTupleById(
            refDbTag, refTupleTag, refTupleId)
            ?? panic('cannot find ref tuple for edit', refTupleId);

        // NEXT populate assertion better!
        // CReating the assertion is a job for the global workspace.
        // USING TUPLE FOR THIS - this needs to factor
        const mostRecentTupleVersion = refTuple.mostRecentTuple
            ?? panic('unexpected missing source tuple');
        const new_assertion: Assertion = Object.assign(
            {},
            mostRecentTupleVersion.assertion,
            {assertion_id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
             replaces_assertion_id: mostRecentTupleVersion.assertion_id });

        this.openFieldEdit(renderRootId, 'replaceSelf', undefined, refDbTag, refTupleTag, refTupleId,
                           new_assertion);
    }

    // editTupleUpdateOFF(renderRootId: string, refDbTag: string, refTupleTag: string, refTupleId: number) {

    //     // --- Find the reference tuple
    //     const refTuple = this.workspace.getVersionedTupleById(
    //         refDbTag, refTupleTag, refTupleId)
    //         ?? panic('cannot find ref tuple for edit', refTupleId);

    //     // NEXT populate assertion better!
    //     // CReating the assertion is a job for the global workspace.
    //     // USING TUPLE FOR THIS - this needs to factor
    //     const mostRecentTupleVersion = refTuple.mostRecentTuple;
    //     // const new_assertion: Assertion = Object.assign(
    //     //     {},
    //     //     mostRecentTupleVersion.assertion);
    //     let new_assertion_: Record<string, any> = {};
    //     for(const k in mostRecentTupleVersion.assertion) {
    //         new_assertion_[k] = (mostRecentTupleVersion.assertion as any)[k];
    //     }
    //     const new_assertion: Assertion = new_assertion_ as Assertion;
    //     console.info('new_assertion["undefined"]', (new_assertion as any)['undefined']);
    //     for(const k in new_assertion) {
    //         console.info('k', k);
    //     }
    //     delete (new_assertion as any)['undefined'];
    //         // TODO: change_by fields clear, from/to
    //     //{assertion_id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)});
    //     console.info('mostRecentTupleVersion.assertion', mostRecentTupleVersion.assertion);
    //     console.info('CAT NEW Assertion A', new_assertion);
    //     new_assertion.assertion_id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    //     console.info('CAT NEW Assertion B', new_assertion);

    //     for(const k in new_assertion) {
    //         console.info('k', k);
    //     }

    //     // const new_assertion2: Assertion = Object.assign(
    //     //     {},
    //     //     mostRecentTupleVersion.assertion,
    //     //     // TODO: change_by fields clear, from/to
    //     //     {assertion_id3: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)});
    //     // console.info('CAT NEW Assertion 2', new_assertion2);

    //     this.openFieldEdit(renderRootId, 'replaceSelf', undefined, refDbTag, refTupleTag, refTupleId,
    //                        new_assertion);
    // }

    deleteTuple(renderRootId: string, refDbTag: string, refTupleTag: string, refTupleId: number) {
        console.info('--- Delete', renderRootId, refTupleId);

        // alert('Delete not implemented');
        // return;

        // --- Find the reference tuple
        const refTuple = this.workspace.getVersionedTupleById(
            refDbTag, refTupleTag, refTupleId)
            ?? panic('cannot find ref tuple for delete', refTupleId);

        console.info('FOUND THE TUPLE TO DELETE! SOOO HAPPY', refTuple);

        if(refTuple.findNonDeletedChildTuples().length > 0) {
            alert('Cannot delete a item with non-deleted children - please delete all children first');
            throw new Error('cannot delete tuple with non-deleted children');
        }

        // --- Find the parent of the reference tuple
        const parentTuple = this.workspace.getVersionedTupleByPath(
            parentAssertionPath(getAssertionPath(refTuple.currentAssertion ??
                panic("can't move up tuple with no parent"))));

        console.info('FOUND THE PARENT OF tHE TUPLE TO DELETE! SOOO HAPPY', parentTuple);
        const parentRelation = parentTuple.childRelations[refTupleTag]
            ?? panic("failed to find parent relation for move up");

        const newAssertion: Assertion = Object.assign(
            {},
            refTuple.currentAssertion,
            {assertion_id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
             replaces_assertion_id: refTuple?.currentAssertion?.assertion_id,
             valid_from: this.nextTime(),
             valid_to: this.nextTime(),
            }
        );

        this.applyAssertion(newAssertion);

        this.rerenderViewById(renderRootId);
    }

    moveUp(renderRootId: string, refDbTag: string, refTupleTag: string, refTupleId: number) {
        console.info('--- Move up', renderRootId, refTupleId);
        alert('move up is not implemented yet');
        return;

        // --- Find the reference tuple
        const refTuple = this.workspace.getVersionedTupleById(
            refDbTag, refTupleTag, refTupleId)
            ?? panic('cannot find ref tuple for edit', refTupleId);

        console.info('FOUND THE TUPLE TO MOVE UP! SOOO HAPPY', refTuple);

        // --- Find the parent of the reference tuple
        const parentTuple = this.workspace.getVersionedTupleByPath(
            parentAssertionPath(getAssertionPath(refTuple.currentAssertion ??
                panic("can't move up tuple with no parent"))));

        console.info('FOUND THE PARENT OF tHE TUPLE TO MOVE UP! SOOO HAPPY', parentTuple);
        const parentRelation = parentTuple.childRelations[refTupleTag]
            ?? panic("failed to find parent relation for move up");

        // ---



        // --- If this tuple is already the first tuple in its parent, nothing to do
        const updatedOrderKey = workspace.generateBeforeOrderKey(
            parentRelation, refTuple.id);

        console.info('updatedOrderKey is', updatedOrderKey);

        const newAssertion: Assertion = Object.assign(
            {},
            refTuple.currentAssertion,
            {assertion_id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
             replaces_assertion_id: refTuple?.currentAssertion?.assertion_id,
             valid_from: this.nextTime(),
             valid_to: timestamp.END_OF_TIME,
             order_key: updatedOrderKey
            }
        );

        this.applyAssertion(newAssertion);

        this.rerenderViewById(renderRootId);
    }

    moveDown(renderRootId: string, refDbTag: string, refTupleTag: string, refTupleId: number) {
        console.info('--- Move down', renderRootId, refTupleId);
        alert('move down is not implemented yet');
    }

    /**
     *
     */
    openFieldEdit(renderRootId: string,
                  refKind: TupleRefKind,
                  refRelation: string|undefined,
                  refDbTag: string,
                  refTupleTag: string,
                  refTupleId: number,
                  new_assertion: Assertion) {
        console.info('begin field edit', refKind, refRelation, refTupleTag, refTupleId);

        // --- Only one tuple editor can be open at a time
        //     (later will get fancier and close open ones or something TODO)
        if(this.currentlyOpenTupleEditor) {
            alert('A field editor is already open');
            return;
        }

        // --- Find the view
        const tupleSchema =
            this.workspace.tables.get(refDbTag)?.schema
            ?.descendantAndSelfRelationsByTag[new_assertion.ty]
            ?? panic('unable to find schema for tag', new_assertion.ty);
        const viewTree: SchemaView =
            (this.activeViews.get(renderRootId)
                ?? panic('unable to find render root', renderRootId))
                .viewTree;
        const tupleView = viewTree.relationViewForRelation.get(tupleSchema) ??
            panic('unable to find relation view for relation', tupleSchema.tag);

        // --- Instantiate a field editor
        this.currentlyOpenTupleEditor = new TupleEditor(
            renderRootId, tupleView, refKind, refRelation, refTupleId, new_assertion);

        // Re-render the tuple with the now open tuple editor
        // - we can use the global workspace to find the tuple by tuple_id ???
        // - figure out how this works for the first tuple in a relation (but sounds
        //   patchable)
        this.rerenderViewById(renderRootId);
    }

    relationViewForRelation(renderRootId: string,
                            tupleSchema: RelationField): RelationView {
        const viewTree: SchemaView =
            (this.activeViews.get(renderRootId)
                ?? panic('unable to find render root', renderRootId))
                .viewTree;
        return viewTree.relationViewForRelation.get(tupleSchema) ??
            panic('unable to find relation view for relation', tupleSchema.tag);
    }

    endFieldEdit() {
        if(!this.currentlyOpenTupleEditor) {
            alert('No field editor is currently open');
            return;
        }

        const tupleEditor = this.currentlyOpenTupleEditor;

        tupleEditor.endFieldEdit();

        const renderRootId = tupleEditor.renderRootId;
        const newAssertion = tupleEditor.assertion;

        newAssertion.valid_from = this.nextTime();
        newAssertion.valid_to = timestamp.END_OF_TIME;

        this.applyAssertion(newAssertion);

        this.currentlyOpenTupleEditor = undefined;

        this.rerenderViewById(renderRootId);
    }
}

/**
 *
 */
export class ActiveView {
    tupleIdsWithHistoryOpen: Set<number> = new Set();

    constructor(public id: string,
                public title: string,
                public viewTree: SchemaView, // This is restricting view to be from one schema XXX revisit
                public query: ()=>CurrentTupleQuery|CurrentRelationQuery) {
    }

    toggleHistory(tupleId: number) {
        if(this.tupleIdsWithHistoryOpen.has(tupleId))
            this.tupleIdsWithHistoryOpen.delete(tupleId);
        else
            this.tupleIdsWithHistoryOpen.add(tupleId);
        this.rerender();
    }

    rerender() {
        const renderer = new EditorRenderer(this.viewTree, this.tupleIdsWithHistoryOpen, this.id);
        const queryResults = this.query();

        let markup;
        if(queryResults instanceof CurrentTupleQuery) {
            markup = renderer.renderTable(queryResults);
        } else if(queryResults instanceof CurrentRelationQuery) {
            markup = renderer.renderRelation(queryResults);
        } else {
            panic('unexpected active view query');
        }

        const modalTitle = document.querySelector(`#${this.id} h1.modal-title`)
            ?? panic('unable to find modal editor title for dialog', this.id);

        modalTitle.innerHTML = this.title;

        const modalBody = document.querySelector(`#${this.id} div.modal-body`)
            ?? panic('unable to find modal editor body for dialog', this.id);

        console.info(`rendering ${this.id}`);

        modalBody.innerHTML = renderToStringViaLinkeDOM(markup);
    }
}


type TupleRefKind = 'replaceSelf' | 'firstChild' | 'lastChild' | 'before' | 'after';


/**
 *
 *
 */
export class TupleEditor {

    constructor(public renderRootId: string,
                public view: RelationView,
                public ref_kind: TupleRefKind,
                public ref_relation: string|undefined,
                public ref_tuple_id: number,
                public assertion: Assertion) {
    }

    endFieldEdit() {
        // We need the schema here to do the reload.
        // Copy field values from form into assertion.
        // field values are named.

        // const view = this.viewTree.relationViewForRelation.get(schema)
        //     ?? panic('unable find relation view for relation', schema.name);
        // return [
        //     ['tr', {id: `tuple-${this.renderRootId}-${t.assertion.assertion_id}`},
        //      ['th', {}, view.prompt],
        //      view.userScalarViews.map(v=>this.renderScalarCellEditor(r, v, t))
        //     ],
        //     ['tr', {},
        //      ['th', {}, ''],
        //      ['td', {colspan: view.userScalarViews.length+3},
        //       ['button', {type:'button', class:'btn btn-primary',
        //                   onclick:'activeViews.endFieldEdit()'}, 'Save'],
        //      ]]
        // ];

        console.info('in endFieldEdit');
        for(const fieldView of this.view.userScalarViews) {
            const formValue = fieldView.loadFromEditor(this.assertion.assertion_id);
            console.info('formValue is', formValue);
            if(formValue !== undefined) {
                (this.assertion as any)[fieldView.field.bind] = formValue;
            }
        }
    }
}

/**
 *
 */
// TODO somewhere we want a workspace.  - probably assoc with active views
// makes more sense for views to own workspace than the other way around.
// difficulty
let activeViews_: ActiveViews|undefined = undefined;
export function activeViews(): ActiveViews {
    return activeViews_ ??= (()=> {
        console.info('*** creating new active view');
        return new ActiveViews(new VersionedDb([]));
    })();
}

/**
 * We have changed how we are doing views (we have switched to transient, single
 * item editors).  This hack is used to put off the deeper refactoring to
 * come if we stick with this change.
 */
export function dropActiveViewsAndWorkspace() {
    console.info('*** dropping active views');
    activeViews_ = undefined;
}

/**
 *
 */
export class EditorRenderer {
    readonly uiColCount = 3;

    constructor(public viewTree: SchemaView,
                public tupleIdsWithHistoryOpen: Set<number>,
                public renderRootId: string) {
    }

    /**
     *
     */
    getViewForRelation(schema: RelationField): RelationView {
        return this.viewTree.relationViewForRelation.get(schema)
            ?? panic('unable find relation view for relation', schema.name);
    }

    /**
     *
     */
    renderTupleAndChildRelations(r: CurrentTupleQuery): Markup {
        const schema = r.schema;
        const view = this.getViewForRelation(schema);
        const currentlyOpenTupleEditor =
            activeViews().getCurrentlyOpenTupleEditorForTupleId(this.renderRootId, r.src.id);

        return [
            // --- If this tuple a proposed new tuple under edit, render the editor,
            //     otherwise render the current row.
            (currentlyOpenTupleEditor?.ref_kind === 'replaceSelf'
                && currentlyOpenTupleEditor?.ref_tuple_id === r.src.id)
                ? this.renderTupleEditor(r.src.schema, currentlyOpenTupleEditor)
                : this.renderTuple(r),

            // --- Render child relations
            schema.relationFields.length > 0 ? [
                ['tr', {},
                 ['td', {class: 'relation-container', colspan: view.userScalarViews.length+this.uiColCount},
                  Object.values(r.childRelations).map(
                      childRelation=>this.renderRelation(childRelation))
                 ]]
            ]: undefined
        ];
    }

    /**
     *
     */
    renderTuple(r: CurrentTupleQuery): Markup {
        const schema = r.schema;
        const view = this.getViewForRelation(schema);
        const isHistoryOpen = this.tupleIdsWithHistoryOpen.has(r.src.id);
        const current = r.mostRecentTupleVersion;
        const tupleJson = JSON.stringify(current?.assertion);

        return [
            ['tr', {id: `tuple-${this.renderRootId}-${current?.assertion_id}`,
                    class: 'tuple'},
             ['th', {}, view.prompt],
             current ? [  // current is undefined for deleted tuples - more work here TODO
                 view.userScalarViews.map(v=>this.renderScalarCell(r, v, current))
             ]: undefined,
             ['td', {class: 'tuple-history', title: tupleJson, onclick: `activeViews().viewByName('${this.renderRootId}').toggleHistory(${r.src.id})`}, '↶'], // style different if have history etc.
             ['td', {class: 'tuple-menu'}, this.renderCurrentTupleMenu(r)]],
            isHistoryOpen
                ? ['tr', {},
                   ['td', {}],
                   ['td',  {colspan: view.userScalarViews.length+this.uiColCount-1}, this.renderHistoryTable(r)]]
                : undefined,
            ];
    }

    /**
     *
     */
    renderRelation(r: CurrentRelationQuery): Markup {

        const schema = r.schema;

        const currentlyOpenTupleEditor = activeViews().getCurrentlyOpenTupleEditorForRenderRootId(this.renderRootId);
        const refKind = currentlyOpenTupleEditor?.ref_kind;
        const refRelation = currentlyOpenTupleEditor?.ref_relation;
        const refId = currentlyOpenTupleEditor?.ref_tuple_id;
        const view = this.getViewForRelation(schema);

        const tuples = [...r.tuples.values()];

        const firstChildEditor =
            (refId === r.src.parent.id && refKind === 'firstChild' && refRelation === schema.tag)
                ? this.renderTupleEditor(r.src.schema, currentlyOpenTupleEditor!)
            : undefined;

        const lastChildEditor =
            (refId === r.src.parent.id && refKind === 'lastChild' && refRelation === schema.tag)
            ? this.renderTupleEditor(r.src.schema, currentlyOpenTupleEditor!)
            : undefined;

        const renderedTuples =
            tuples.map(t=>{
                const tuple_id = t.src.id;
                return [
                    [tuple_id === refId && refKind === 'before'
                        ? this.renderTupleEditor(t.schema,  currentlyOpenTupleEditor!)
                        : undefined],
                    this.renderTupleAndChildRelations(t),
                    [tuple_id === refId && refKind === 'after'
                        ? this.renderTupleEditor(t.schema,  currentlyOpenTupleEditor!)
                        : undefined]
                ];
            });

        if(renderedTuples.length === 0 && !firstChildEditor && !lastChildEditor) {
            const addTupleAction =
                `activeViews().editNewLastChild('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.parent.id}, '${r.src.schema.tag}')`;
        return ['button', {onclick: addTupleAction},
                `Insert ${view.prompt}`];
    }

    return (
            // This table has the number of cols in the schema for 'r'
            ['table', {class: `relation relation-${schema.name}`},
             firstChildEditor,
             renderedTuples,
             lastChildEditor,
            ]);
    }

    renderTable(r: CurrentTupleQuery): Markup {
        return (
            ['table', {class: `relation relation-${r.schema.name}`},
             this.renderTupleAndChildRelations(r),
            ]);
    }

    /**
     *
     */
    renderHistoryTable(r: CurrentTupleQuery): Markup {
        const schema = r.schema;
        const view = this.getViewForRelation(schema);
        const historicalTupleVersions = r.historicalTupleVersions.toReversed();
        if(historicalTupleVersions.length === 0)
            return ['strong', {}, 'No history'];
        else
            return ['table', {class: 'history-table'},
                    historicalTupleVersions.map(h=>
                        ['tr', {},
                         ['td', {}],  // Empty header col
                         ['td', {},
                          timestamp.formatTimestampAsLocalTime(h.assertion.valid_from)],
                         ['td', {},
                          timestamp.formatTimestampAsLocalTime(h.assertion.valid_to)],
                         view.userScalarViews.map(v=>this.renderScalarCell(r, v, h, true)),
                         ['td', {},
                          h.assertion.change_by_username],
                        ])
                   ];
    }

    // ??? What happens if the tuple is rendered twice on the same screen - this current id scheme implies both should be under
    // edit.   We either have to disallow having the renderer twice (which seems like an unreasonable restriction) - or scope this
    // somehow.
    // We need to scope our render trees!
    // - Probably better to move tuple under edit into this view class? (it really does belong to it - not to the
    //   shared global thing)
    renderScalarCell(r: CurrentTupleQuery, v: ScalarView, t: TupleVersion, history: boolean=false): Markup {
        const value = (t.assertion as any)[v.field.bind]; // XXX fix typing
        return (
            ['td', {class: `field field-${v.field.schemaTypename()}`,
                    onclick:`activeViews().editTupleUpdate('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`,
                   },
             v.renderView(value)
            ]);
    }

    renderTupleEditor(schema: RelationField, t: TupleEditor): Markup {
        const view = this.getViewForRelation(schema);
        //const isHistoryOpen = this.tupleIdsWithHistoryOpen.has(r.src.id);
        return [
            ['tr', {id: `tuple-${this.renderRootId}-${t.assertion.assertion_id}`},
             ['th', {}, view.prompt],
             view.userScalarViews.map(v=>this.renderScalarCellEditor(v, t))
            ],

            ['tr', {},
             ['th', {}, ''],
             ['td', {colspan: view.userScalarViews.length+this.uiColCount},
              ['button', {type:'button', class:'btn btn-primary',
                          onclick:'activeViews().endFieldEdit()'}, 'Update'],
             ],

             // TODO: add history when under edit.  Not so simple because need
             //       to find tuple by id - so need to add that index first.
             // isHistoryOpen
             //    ? ['tr', {},
             //       ['td', {}],
             //       ['td',  {colspan: view.userScalarViews.length+this.uiColCount}, this.renderHistoryTable(r)]]
             //    : undefined,


            ]
        ];
    }

    renderScalarCellEditor(v: ScalarView, t: TupleEditor): Markup {
        const value = (t.assertion as any)[v.field.bind];     // XXX be fancy here;
        return (
            ['td', {class: `fieldedit`},
             v.renderEditor(t.assertion.assertion_id, value)
            ]);
    }

    // TODO: the event handlers should not be literal onclick scripts on each
    //       item (bloat).
    // TODO: add an 'Insert Child XXX' for each child relation kind.
    renderCurrentTupleMenu(r: CurrentTupleQuery): Markup {
        const insertChildMenuItems =
            r.schema.relationFields.map(c=>
                ['li', {},
                 ['a', {class:'dropdown-item', href:'#',
                        onclick:`activeViews().editNewLastChild('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id}, '${c.tag}')`},
                  `Insert Child ${this.viewTree.relationViewForRelation.get(c)?.prompt}`
                 ]]);

        // 'true||undefined' type is convenient for eliding sections of markup.
        const isLeaf = workspace.isRootTupleId(r.src.id) ? undefined : true;

        return (
            ['div', {class:'dropdown'},
             ['button',
              {class:'btn btn-secondary dropdown-toggle',
               type:'button', 'data-bs-toggle':'dropdown', 'aria-expanded':'false'},
              '≡'],
             ['ul', {class:'dropdown-menu'},
              ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().editTupleUpdate('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Edit']],
              isLeaf && [
                  ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().moveUp('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Move Up']],
                  ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().moveDown('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Move Down']],
                  ['li', {}, ['a', {class:'dropdown-item', href:'#',
                                    onclick:`activeViews().editNewAbove('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Insert Above']],
                  ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().editNewBelow('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Insert Below']],
                  insertChildMenuItems,
                  ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().deleteTuple('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Delete']],
              ], // isLeaf
              //['li', {}, ['a', {class:'dropdown-item', href:'#'}, 'Show History']],
             ]]);
    }
}

// /**
//  *
//  */
// export class EditorRenderer {
//     readonly uiColCount = 3;

//     constructor(public viewTree: SchemaView,
//                 public tupleIdsWithHistoryOpen: Set<number>,
//                 public renderRootId: string) {
//     }

//     /**
//      *
//      */
//     getViewForRelation(schema: RelationField): RelationView {
//         return this.viewTree.relationViewForRelation.get(schema)
//             ?? panic('unable find relation view for relation', schema.name);
//     }

//     /**
//      *
//      */
//     renderTupleAndChildRelations(r: CurrentTupleQuery): Markup {
//         const schema = r.schema;
//         const view = this.getViewForRelation(schema);
//         const currentlyOpenTupleEditor =
//             activeViews().getCurrentlyOpenTupleEditorForTupleId(this.renderRootId, r.src.id);

//         return [
//             // --- If this tuple a proposed new tuple under edit, render the editor,
//             //     otherwise render the current row.
//             (currentlyOpenTupleEditor?.ref_kind === 'replaceSelf'
//                 && currentlyOpenTupleEditor?.ref_tuple_id === r.src.id)
//                 ? this.renderTupleEditor(r.src.schema, currentlyOpenTupleEditor)
//                 : this.renderTuple(r),

//             // --- Render child relations
//             schema.relationFields.length > 0 ? [
//                 ['tr', {},
//                  ['td', {class: 'relation-container', colspan: view.userScalarViews.length+this.uiColCount},
//                   Object.values(r.childRelations).map(
//                       childRelation=>this.renderRelation(childRelation))
//                  ]]
//             ]: undefined
//         ];
//     }

//     /**
//      *
//      */
//     renderTuple(r: CurrentTupleQuery): Markup {
//         const schema = r.schema;
//         const view = this.getViewForRelation(schema);
//         const isHistoryOpen = this.tupleIdsWithHistoryOpen.has(r.src.id);
//         const current = r.mostRecentTupleVersion;
//         const tupleJson = JSON.stringify(current?.assertion);

//         return [
//             ['tr', {id: `tuple-${this.renderRootId}-${current?.assertion_id}`,
//                     class: 'tuple'},
//              ['th', {}, view.prompt],
//              current ? [  // current is undefined for deleted tuples - more work here TODO
//                  view.userScalarViews.map(v=>this.renderScalarCell(r, v, current))
//              ]: undefined,
//              ['td', {class: 'tuple-history', title: tupleJson, onclick: `activeViews().viewByName('${this.renderRootId}').toggleHistory(${r.src.id})`}, '↶'], // style different if have history etc.
//              ['td', {class: 'tuple-menu'}, this.renderCurrentTupleMenu(r)]],
//             isHistoryOpen
//                 ? ['tr', {},
//                    ['td', {}],
//                    ['td',  {colspan: view.userScalarViews.length+this.uiColCount-1}, this.renderHistoryTable(r)]]
//                 : undefined,
//             ];
//     }

//     /**
//      *
//      */
//     renderRelation(r: CurrentRelationQuery): Markup {

//         const schema = r.schema;

//         const currentlyOpenTupleEditor = activeViews().getCurrentlyOpenTupleEditorForRenderRootId(this.renderRootId);
//         const refKind = currentlyOpenTupleEditor?.ref_kind;
//         const refRelation = currentlyOpenTupleEditor?.ref_relation;
//         const refId = currentlyOpenTupleEditor?.ref_tuple_id;
//         const view = this.getViewForRelation(schema);

//         const tuples = [...r.tuples.values()];

//         const firstChildEditor =
//             (refId === r.src.parent.id && refKind === 'firstChild' && refRelation === schema.tag)
//                 ? this.renderTupleEditor(r.src.schema, currentlyOpenTupleEditor!)
//             : undefined;

//         const lastChildEditor =
//             (refId === r.src.parent.id && refKind === 'lastChild' && refRelation === schema.tag)
//             ? this.renderTupleEditor(r.src.schema, currentlyOpenTupleEditor!)
//             : undefined;

//         const renderedTuples =
//             tuples.map(t=>{
//                 const tuple_id = t.src.id;
//                 return [
//                     [tuple_id === refId && refKind === 'before'
//                         ? this.renderTupleEditor(t.schema,  currentlyOpenTupleEditor!)
//                         : undefined],
//                     this.renderTupleAndChildRelations(t),
//                     [tuple_id === refId && refKind === 'after'
//                         ? this.renderTupleEditor(t.schema,  currentlyOpenTupleEditor!)
//                         : undefined]
//                 ];
//             });

//         if(renderedTuples.length === 0 && !firstChildEditor && !lastChildEditor) {
//             const addTupleAction =
//                 `activeViews().editNewLastChild('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.parent.id}, '${r.src.schema.tag}')`;
//         return ['button', {onclick: addTupleAction},
//                 `Insert ${view.prompt}`];
//     }

//     return (
//             // This table has the number of cols in the schema for 'r'
//             ['table', {class: `relation relation-${schema.name}`},
//              firstChildEditor,
//              renderedTuples,
//              lastChildEditor,
//             ]);
//     }

//     renderTable(r: CurrentTupleQuery): Markup {
//         return (
//             ['table', {class: `relation relation-${r.schema.name}`},
//              this.renderTupleAndChildRelations(r),
//             ]);
//     }

//     /**
//      *
//      */
//     renderHistoryTable(r: CurrentTupleQuery): Markup {
//         const schema = r.schema;
//         const view = this.getViewForRelation(schema);
//         const historicalTupleVersions = r.historicalTupleVersions.toReversed();
//         if(historicalTupleVersions.length === 0)
//             return ['strong', {}, 'No history'];
//         else
//             return ['table', {class: 'history-table'},
//                     historicalTupleVersions.map(h=>
//                         ['tr', {},
//                          ['td', {}],  // Empty header col
//                          ['td', {},
//                           timestamp.formatTimestampAsLocalTime(h.assertion.valid_from)],
//                          ['td', {},
//                           timestamp.formatTimestampAsLocalTime(h.assertion.valid_to)],
//                          view.userScalarViews.map(v=>this.renderScalarCell(r, v, h, true)),
//                          ['td', {},
//                           h.assertion.change_by_username],
//                         ])
//                    ];
//     }

//     // ??? What happens if the tuple is rendered twice on the same screen - this current id scheme implies both should be under
//     // edit.   We either have to disallow having the renderer twice (which seems like an unreasonable restriction) - or scope this
//     // somehow.
//     // We need to scope our render trees!
//     // - Probably better to move tuple under edit into this view class? (it really does belong to it - not to the
//     //   shared global thing)
//     renderScalarCell(r: CurrentTupleQuery, v: ScalarView, t: TupleVersion, history: boolean=false): Markup {
//         const value = (t.assertion as any)[v.field.bind]; // XXX fix typing
//         return (
//             ['td', {class: `field field-${v.field.schemaTypename()}`,
//                     onclick:`activeViews().editTupleUpdate('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`,
//                    },
//              v.renderView(value)
//             ]);
//     }

//     renderTupleEditor(schema: RelationField, t: TupleEditor): Markup {
//         const view = this.getViewForRelation(schema);
//         //const isHistoryOpen = this.tupleIdsWithHistoryOpen.has(r.src.id);
//         return [
//             ['tr', {id: `tuple-${this.renderRootId}-${t.assertion.assertion_id}`},
//              ['th', {}, view.prompt],
//              view.userScalarViews.map(v=>this.renderScalarCellEditor(v, t))
//             ],

//             ['tr', {},
//              ['th', {}, ''],
//              ['td', {colspan: view.userScalarViews.length+this.uiColCount},
//               ['button', {type:'button', class:'btn btn-primary',
//                           onclick:'activeViews().endFieldEdit()'}, 'Update'],
//              ],

//              // TODO: add history when under edit.  Not so simple because need
//              //       to find tuple by id - so need to add that index first.
//              // isHistoryOpen
//              //    ? ['tr', {},
//              //       ['td', {}],
//              //       ['td',  {colspan: view.userScalarViews.length+this.uiColCount}, this.renderHistoryTable(r)]]
//              //    : undefined,


//             ]
//         ];
//     }

//     renderScalarCellEditor(v: ScalarView, t: TupleEditor): Markup {
//         const value = (t.assertion as any)[v.field.bind];     // XXX be fancy here;
//         return (
//             ['td', {class: `fieldedit`},
//              v.renderEditor(t.assertion.assertion_id, value)
//             ]);
//     }

//     // TODO: the event handlers should not be literal onclick scripts on each
//     //       item (bloat).
//     // TODO: add an 'Insert Child XXX' for each child relation kind.
//     renderCurrentTupleMenu(r: CurrentTupleQuery): Markup {
//         const insertChildMenuItems =
//             r.schema.relationFields.map(c=>
//                 ['li', {},
//                  ['a', {class:'dropdown-item', href:'#',
//                         onclick:`activeViews().editNewLastChild('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id}, '${c.tag}')`},
//                   `Insert Child ${this.viewTree.relationViewForRelation.get(c)?.prompt}`
//                  ]]);

//         // 'true||undefined' type is convenient for eliding sections of markup.
//         const isLeaf = workspace.isRootTupleId(r.src.id) ? undefined : true;

//         return (
//             ['div', {class:'dropdown'},
//              ['button',
//               {class:'btn btn-secondary dropdown-toggle',
//                type:'button', 'data-bs-toggle':'dropdown', 'aria-expanded':'false'},
//               '≡'],
//              ['ul', {class:'dropdown-menu'},
//               ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().editTupleUpdate('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Edit']],
//               isLeaf && [
//                   ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().moveUp('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Move Up']],
//                   ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().moveDown('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Move Down']],
//                   ['li', {}, ['a', {class:'dropdown-item', href:'#',
//                                     onclick:`activeViews().editNewAbove('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Insert Above']],
//                   ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().editNewBelow('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Insert Below']],
//                   insertChildMenuItems,
//                   ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().deleteTuple('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Delete']],
//               ], // isLeaf
//               //['li', {}, ['a', {class:'dropdown-item', href:'#'}, 'Show History']],
//              ]]);
//     }
// }

// ---------------------------------------------------------------------------------
// --- View Renderer ---------------------------------------------------------------
// ---------------------------------------------------------------------------------

// /**
//  *
//  */
// export class ViewRenderer {
//     readonly uiColCount = 3;

//     constructor(public viewTree: SchemaView,
//                 public tupleIdsWithHistoryOpen: Set<number>,
//                 public renderRootId: string) {
//     }

//     getViewForRelation(schema: RelationField): RelationView {
//         return this.viewTree.relationViewForRelation.get(schema)
//             ?? panic('unable find relation view for relation', schema.name);
//     }

//     renderRelation(r: CurrentRelationQuery): Markup {
//         const schema = r.schema;
//         const view = this.getViewForRelation(schema);
//         return (
//             // This table has the number of cols in the schema for 'r'
//             ['table', {class: `relation relation-${schema.name}`},

//              [...r.tuples.values()].map(t=>{
//                  const tuple_id = t.src.id;
//                  return [
//                      this.renderTuple(t),
//                  ];
//              }),
//             ]);
//     }

//     renderTable(r: CurrentTupleQuery): Markup {
//         return (
//             ['table', {class: `relation relation-${r.schema.name}`},
//              this.renderTuple(r),
//             ]);
//     }

//     renderTuple(r: CurrentTupleQuery): Markup {
//         const schema = r.schema;
//         const view = this.getViewForRelation(schema);

//         return [
//             this.renderCurrentTupleRow(r),

//             // --- Render child relations
//             schema.relationFields.length > 0 ? [
//                 ['tr', {},
//                  ['td', {class: 'relation-container', colspan: view.userScalarViews.length+this.uiColCount},
//                   Object.values(r.childRelations).map(
//                       childRelation=>this.renderRelation(childRelation))
//                  ]]
//             ]: undefined
//         ];
//     }

//     /**
//      *
//      */
//     renderCurrentTupleRow(r: CurrentTupleQuery): Markup {
//         const schema = r.schema;
//         const view = this.getViewForRelation(schema);
//         const isHistoryOpen = this.tupleIdsWithHistoryOpen.has(r.src.id);
//         const current = r.mostRecentTupleVersion;
//         const tupleJson = JSON.stringify(current?.assertion);
//         return [
//             ['tr', {id: `tuple-${this.renderRootId}-${current?.assertion_id}`,
//                     class: 'tuple'},
//              ['th', {}, view.prompt],
//              current ? [  // current is undefined for deleted tuples - more work here TODO
//                  view.userScalarViews.map(v=>this.renderScalarCell(r, v, current))
//              ]: undefined,
//              ['td', {class: 'tuple-history', title: tupleJson, onclick: `activeViews().viewByName('${this.renderRootId}').toggleHistory(${r.src.id})`}, '↶'], // style different if have history etc.
//              ['td', {class: 'tuple-menu'}, this.renderCurrentTupleMenu(r)]],
//             isHistoryOpen
//                 ? ['tr', {},
//                    ['td', {}],
//                    ['td',  {colspan: view.userScalarViews.length+this.uiColCount-1}, this.renderHistoryTable(r)]]
//                 : undefined,
//             ];
//     }

//     /**
//      *
//      */
//     renderHistoryTable(r: CurrentTupleQuery): Markup {
//         const schema = r.schema;
//         const view = this.getViewForRelation(schema);
//         const historicalTupleVersions = r.historicalTupleVersions.toReversed();
//         if(historicalTupleVersions.length === 0)
//             return ['strong', {}, 'No history'];
//         else
//             return ['table', {},
//                     historicalTupleVersions.map(h=>
//                         ['tr', {},
//                          ['td', {}],  // Empty header col
//                          ['td', {},
//                           timestamp.formatTimestampAsLocalTime(h.assertion.valid_from)],
//                          ['td', {},
//                           timestamp.formatTimestampAsLocalTime(h.assertion.valid_to)],
//                          view.userScalarViews.map(v=>this.renderScalarCell(r, v, h, true)),
//                          ['td', {},
//                           h.assertion.change_by_username],
//                         ])
//                    ];
//     }

//     renderScalarCell(r: CurrentTupleQuery, v: ScalarView, t: TupleVersion, history: boolean=false): Markup {
//         const value = (t.assertion as any)[v.field.bind]; // XXX fix typing
//         return (
//             ['td', {class: `field field-${v.field.schemaTypename()}`,
//                     onclick:`activeViews().editTupleUpdate('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`,
//                    },
//              v.renderView(value)
//             ]);
//     }

//     // TODO: the event handlers should not be literal onclick scripts on each
//     //       item (bloat).
//     renderCurrentTupleMenu(r: CurrentTupleQuery): Markup {
//         const insertChildMenuItems =
//             r.schema.relationFields.map(c=>
//                 ['li', {},
//                  ['a', {class:'dropdown-item', href:'#',
//                         onclick:`activeViews().editNewLastChild('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id}, '${c.tag}')`},
//                   `Insert Child ${this.viewTree.relationViewForRelation.get(c)?.prompt}`
//                  ]]);

//         // 'true||undefined' type is convenient for eliding sections of markup.
//         const isLeaf = workspace.isRootTupleId(r.src.id) ? undefined : true;

//         return (
//             ['div', {class:'dropdown'},
//              ['button',
//               {class:'btn btn-secondary dropdown-toggle',
//                type:'button', 'data-bs-toggle':'dropdown', 'aria-expanded':'false'},
//               '≡'],
//              ['ul', {class:'dropdown-menu'},
//               ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().editTupleUpdate('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Edit']],
//               isLeaf && [
//                   ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().moveUp('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Move Up']],
//                   ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().moveDown('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Move Down']],
//                   ['li', {}, ['a', {class:'dropdown-item', href:'#',
//                                     onclick:`activeViews().editNewAbove('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Insert Above']],
//                   ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews().editNewBelow('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Insert Below']],
//                   insertChildMenuItems,
//                   ['li', {}, ['a', {class:'dropdown-item', href:'#'}, 'Delete']],
//               ], // isLeaf
//               //['li', {}, ['a', {class:'dropdown-item', href:'#'}, 'Show History']],
//              ]]);
//     }
// }

// ----------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------

/**
 *
 */
export class FieldToView implements FieldVisitorI<any,View> {
    visitBooleanField(f: BooleanField, v: any): View { return new BooleanView(f); }
    visitIntegerField(f: IntegerField, v: any): View { return new IntegerView(f); }
    visitFloatField(f: FloatField, v: any): View { return new FloatView(f); }
    visitStringField(f: StringField, v: any): View { return new StringView(f); }
    visitEnumField(f: EnumField, v: any): View { return new EnumView(f); }
    visitVariantField(f: VariantField, v: any): View { return new VariantView(f); }
    visitBlobField(f: BlobField, v: any): View { return new BlobView(f); }
    visitAudioField(f: AudioField, v: any): View { return new AudioView(f); }
    visitImageField(f: ImageField, v: any): View { return new ImageView(f); }
    visitIdField(f: IdField, v: any): View { return new IdView(f); }
    visitPrimaryKeyField(f: PrimaryKeyField, v: any): View { return new PrimaryKeyView(f); }
    visitRelationField(f: RelationField, v: any): View {
        return new RelationView(f, f.fields.map(fieldToView));
    }
    visitSchema(f: Schema, v: any): View {
        return new SchemaView(f, f.fields.map(fieldToView));
    }
}

const fieldToViewInst = new FieldToView();

export function fieldToView(f: Field): View {
    return f.accept(fieldToViewInst, undefined);
}

export function schemaView(f: Schema): SchemaView {
    return new SchemaView(f, f.fields.map(fieldToView));
}

/**
 *
 */
export function renderEditor(r: RelationView): any {
}

// export async function run0() {
//     console.info('rendering sample');

//     const root = document.getElementById('root') ?? panic();
//     root.innerHTML = 'POW!';

//     const entryId = 1000;
//     const assertions = await rpc`getAssertionsForEntry(${entryId})`;
//     console.info('Assertions', JSON.stringify(assertions, undefined, 2));

//     const rendered = workspace.testRenderEntry(assertions);

//     root.innerHTML = renderToStringViaLinkeDOM(rendered);


// }

// export async function run() {
//     console.info('rendering sample 2');
//     const views = activeViews();

//     const dictSchema = model.Schema.parseSchemaFromCompactJson('dict', dictSchemaJson);
//     views.workspace.addTable(dictSchema);






//     const dictView = schemaView(dictSchema);

//     views.registerActiveView(
//         new ActiveView('root',
//                        dictView,
//                        ()=>new CurrentTupleQuery(views.workspace.getTableByTag('dct'))));

//     const root = document.getElementById('root') ?? panic();
//     root.innerHTML = 'POW!';

//     const entryId = 1000;
//     const assertions = await rpc`getAssertionsForEntry(${entryId})`;
//     console.info('Assertions', JSON.stringify(assertions, undefined, 2));

//     const rendered = workspace.testRenderEntry(assertions);

//     root.innerHTML = renderToStringViaLinkeDOM(rendered);


// }


export function renderModalEditorSkeleton() {

    return [
        ['div', {class: 'modal fade',  id:'modalEditor',
                 'data-bs-backdrop':'static', 'data-bs-keyboard':'false',
                 tabindex:'-1', 'aria-labelledby':'modalEditorLabel',
                 'aria-hidden':'true'},
         ['div', {class:'modal-dialog modal-dialog-scrollable modal-fullscreen'},

          ['div', {class:'modal-content'},

           ['div', {class:'modal-header'},
            ['h1', {class:'modal-title fs-5', id:'modalEditorLabel'},
             'Edit'],
            ['button', {type:'button', class:'btn-close', 'data-bs-dismiss':'modal',
                        'aria-label':'Close'}]

           ], // div.modal-header

           ['div', {class:'modal-body', id:'modalEditorBody'}

           ], // div.modal-body

           ['div', {class:'modal-footer'},
            ['button', {type:'button', class:'btn btn-secondary',
                        'data-bs-dismiss':'modal',
                        //onclick:'activeViews().saveChanges()'}, 'Save']
                        onclick:'location.reload()'}, 'Close']
           ], // div.modal-footer

          ] // div.modal-content

         ] // div.modal-dialog

        ] // div.modal
    ];

}

/**
 *
 */
export function initPopupEntryEditor() {

}

/**
 * This editor expects to run in an environment where the bootstrap JS code
 * has been loaded as a script.  This function packages accessing the bootstrap
 * global inst via the browser window object.
 */
export function getGlobalBoostrapInst() {
    return (window as any)?.bootstrap
        ?? panic("can't find global bootstrap inst");
}

/**
 *
 * TODO: firing this again while it is loading will (like on a slow connection) needs
 *       some protection.
 */
export async function popupEntryEditor(title: string,
                                       entryId: number,
                                       nestedTypeTag:string='ent',
                                       nestedId:number=entryId,
                                       restrictToRelation:string|undefined = undefined) {

    // TODO make this less weird
    const assertions = await rpc`getAssertionsForEntry(${entryId})`;

    dropActiveViewsAndWorkspace();

    const views = activeViews();

    const dictSchema = model.Schema.parseSchemaFromCompactJson('dict', dictSchemaJson);
    views.workspace.addTable(dictSchema);

    assertions.forEach((a:Assertion)=>views.workspace.untrackedApplyAssertion(a));

    const dictView = schemaView(dictSchema);

    let query: ()=>CurrentTupleQuery|CurrentRelationQuery;
    if(restrictToRelation)
        query = ()=>new CurrentTupleQuery(
            views.workspace.getVersionedTupleById('dct', nestedTypeTag, nestedId)
                ?? panic('unable to find entry', entryId)).childRelations[restrictToRelation]
        ?? panic('unable to find relation to view', restrictToRelation);
    else
        query = ()=>new CurrentTupleQuery(
            views.workspace.getVersionedTupleById('dct', nestedTypeTag, nestedId) ?? panic('unable to find entry', entryId));

    views.registerActiveView(new ActiveView('modalEditor', title, dictView, query));

    views.rerenderAllViews();

    getGlobalBoostrapInst().Modal.getOrCreateInstance('#modalEditor').show();

    //console.info('Assertions', JSON.stringify(assertions, undefined, 2));

}

/**
 * XXX todo this is panic written proto crap that should be redone and moved!
 */
export function launchAddNewDocumentReference(entry_id: number, subentry_id: number, friendly_document_id: string, title?: string) {
    console.info('*** Launching add new document reference', entry_id, subentry_id, friendly_document_id, title);
    // Await an RPC that does the data changes.
    // When the RPC returns, navigate to the URL that is returned.
    (async ()=>{
        const editorUrl = await rpc`wordwiki.addNewDocumentReference(${entry_id}, ${subentry_id}, ${friendly_document_id}, ${title})`;
        console.info('*** Editor URL is', editorUrl);
        window.open(editorUrl.location, '_blank');
    })();
}

// XXX XXX KIWLL ME!!! I AM bAD
export function launchNewLexeme() {
    console.info('*** Launching new lexeme');
    // Await an RPC that does the data changes.
    // When the RPC returns, navigate to the URL that is returned.
    (async ()=>{
        const lexemeUrl = (await rpc`wordwiki.addNewLexeme()`).location;
        console.info('*** Lexeme URL is', lexemeUrl);
        window.location = lexemeUrl;
    })();
}


/**
 *
 */
export async function run() {
    return;

    console.info('rendering sample 2');
    const views = activeViews();

    const dictSchema = model.Schema.parseSchemaFromCompactJson('dict', dictSchemaJson);
    views.workspace.addTable(dictSchema);

    const dictView = schemaView(dictSchema);

    views.registerActiveView(
        new ActiveView('root',
                       'Edit ENTRY',
                       dictView,
                       ()=>new CurrentTupleQuery(views.workspace.getTableByTag('dct'))));

    // const root = document.getElementById('root') ?? panic();
    // root.innerHTML = 'POW!';

    // TODO make this less weird
    const entryId = 1000;
    const assertions = await rpc`getAssertionsForEntry(${entryId})`;
    //console.info('Assertions', JSON.stringify(assertions, undefined, 2));
    assertions.forEach((a:Assertion)=>views.workspace.untrackedApplyAssertion(a));


    activeViews().rerenderAllViews();

}

export const exportToBrowser = ()=> ({
    activeViews,
    run,
    popupEntryEditor,
    launchAddNewDocumentReference,
    launchNewLexeme,
    //popupRelationEditor,
    //beginFieldEdit,
});

export const routes = ()=> ({
});
